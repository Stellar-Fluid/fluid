import StellarSdk, { Transaction } from "@stellar/stellar-sdk";
import { NextFunction, Request, Response } from "express";
import { Config, pickFeePayerAccount } from "../config";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { syncTenantFromApiKey } from "../models/tenantStore";
import { recordSponsoredTransaction } from "../models/transactionLedger";
import { FeeBumpRequest, FeeBumpSchema } from "../schemas/feeBump";
import { checkTenantDailyQuota } from "../services/quota";
import { calculateFeeBumpFee } from "../utils/feeCalculator";
import { MockPriceOracle, validateSlippage } from "../utils/priceOracle";
import { transactionStore } from "../workers/transactionStore";

interface FeeBumpResponse {
  xdr: string;
  status: "ready" | "submitted";
  hash?: string;
  fee_payer: string;
  submitted_via?: string;
  submission_attempts?: number;
}

export async function feeBumpHandler(
  req: Request,
  res: Response,
  config: Config,
  next: NextFunction,
): Promise<void> {
  try {
    const parsedBody = FeeBumpSchema.safeParse(req.body);

    if (!parsedBody.success) {
      console.warn(
        "Validation failed for fee-bump request:",
        parsedBody.error.format(),
      );

      return next(
        new AppError(
          `Validation failed: ${JSON.stringify(parsedBody.error.format())}`,
          400,
          "INVALID_XDR",
        ),
      );
    }

    const body: FeeBumpRequest = parsedBody.data;
    const feePayerAccount = pickFeePayerAccount(config);
    console.log(
      `Received fee-bump request | fee_payer: ${feePayerAccount.publicKey}`,
    );

    let innerTransaction: Transaction;

    try {
      innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
        body.xdr,
        config.networkPassphrase,
      ) as Transaction;
    } catch (error: any) {
      console.error("Failed to parse XDR:", error.message);
      return next(
        new AppError(`Invalid XDR: ${error.message}`, 400, "INVALID_XDR"),
      );
    }

    if (
      !innerTransaction.signatures ||
      innerTransaction.signatures.length === 0
    ) {
      return next(
        new AppError(
          "Inner transaction must be signed before fee-bumping",
          400,
          "UNSIGNED_TRANSACTION",
        ),
      );
    }

    if ("innerTransaction" in innerTransaction) {
      return next(
        new AppError(
          "Cannot fee-bump an already fee-bumped transaction",
          400,
          "ALREADY_FEE_BUMPED",
        ),
      );
    }

    const operationCount = innerTransaction.operations?.length || 0;
    const feeAmount = calculateFeeBumpFee(
      operationCount,
      config.baseFee,
      config.feeMultiplier,
    );

    // Verify settlement payment if token is specified
    const settlementRequirement = extractSettlementRequirement(
      body.token,
      feeAmount,
    );
    if (settlementRequirement) {
      const settlementVerification = verifySettlementPayment(
        innerTransaction,
        settlementRequirement,
        config,
      );

      if (!settlementVerification.isValid) {
        console.error(
          `Settlement verification failed: ${settlementVerification.reason}`,
        );
        return next(
          new AppError(
            `Settlement verification failed: ${settlementVerification.reason}`,
            400,
            "SETTLEMENT_VERIFICATION_FAILED",
          ),
        );
      }
    }

    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      res.status(500).json({
        error: "Missing tenant context for fee sponsorship",
      });
      return;
    }

    const tenant = syncTenantFromApiKey(apiKeyConfig);
    const quotaCheck = await checkTenantDailyQuota(tenant, feeAmount);
    if (!quotaCheck.allowed) {
      res.status(403).json({
        error: "Daily fee sponsorship quota exceeded",
        currentSpendStroops: quotaCheck.currentSpendStroops,
        attemptedFeeStroops: feeAmount,
        dailyQuotaStroops: quotaCheck.dailyQuotaStroops,
      });
      return;
    }

    // Slippage protection for token payments
    if (body.token && body.maxSlippage !== undefined) {
      const priceOracle = new MockPriceOracle();
      const requestTime = Date.now();

      try {
        const currentPrice = await priceOracle.getCurrentPrice(body.token);
        const historicalPrice = await priceOracle.getHistoricalPrice(
          body.token,
          requestTime - 120000,
        ); // 2 minutes ago

        const slippageCheck = validateSlippage(
          historicalPrice,
          currentPrice,
          body.maxSlippage,
        );

        if (!slippageCheck.valid) {
          return next(
            new AppError(
              "Slippage too high: try increasing your fee payment",
              400,
              "SLIPPAGE_TOO_HIGH",
            ),
          );
        }

        console.log(
          `Slippage check passed | token: ${body.token} | slippage: ${slippageCheck.actualSlippage.toFixed()}% | max: ${body.maxSlippage}%`,
        );
      } catch (error: any) {
        console.error("Price oracle error:", error.message);
        return next(
          new AppError(
            `Failed to verify token price: ${error.message}`,
            500,
            "INTERNAL_ERROR",
          ),
        );
      }
    }

    // Preflight simulation for Soroban transactions
    const isSoroban = innerTransaction.operations.some((op: any) =>
      ["invokeHostFunction", "extendFootprintTtl", "restoreFootprint"].includes(
        op.type,
      ),
    );

    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feePayerAccount.keypair,
      feeAmount.toString(),
      innerTransaction,
      config.networkPassphrase,
    );

    feeBumpTx.sign(feePayerAccount.keypair);
    await recordSponsoredTransaction(tenant.id, feeAmount);

    const feeBumpXdr = feeBumpTx.toXDR();
    console.log(
      `Fee-bump transaction created | fee_payer: ${feePayerAccount.publicKey}`,
    );

    const submit = body.submit || false;
    if (submit && config.horizonUrl) {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);

      try {
        const submissionResult = await server.submitTransaction(feeBumpTx);
        transactionStore.addTransaction(submissionResult.hash, tenant.id, "submitted");

        const response: FeeBumpResponse = {
          xdr: feeBumpXdr,
          status: "submitted",
          hash: submissionResult.hash,
          fee_payer: feePayerAccount.publicKey,
        };
        res.json(response);
        return;
      } catch (error: any) {
        console.error("Transaction submission failed:", error);
        return next(
          new AppError(
            `Transaction submission failed: ${error.message}`,
            500,
            "SUBMISSION_FAILED",
          ),
        );
      }
    }

    const response: FeeBumpResponse = {
      xdr: feeBumpXdr,
      status: submit ? "submitted" : "ready",
      fee_payer: feePayerAccount.publicKey,
    };

    res.json(response);
  } catch (error: any) {
    console.error("Error processing fee-bump request:", error);
    next(error);
  }
}
