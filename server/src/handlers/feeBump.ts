import { broadcastUpdate } from "./events";
import { NextFunction, Request, Response } from "express";
import StellarSdk, { Transaction } from "@stellar/stellar-sdk";
import { Config, pickFeePayerAccount } from "../config";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { syncTenantFromApiKey } from "../models/tenantStore";
import { recordSponsoredTransaction } from "../models/transactionLedger";
import { FeeBumpRequest, FeeBumpSchema } from "../schemas/feeBump";
import { checkTenantDailyQuota } from "../services/quota";
import { calculateFeeBumpFee } from "../utils/feeCalculator";
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
  next: NextFunction,
  config: Config,
): Promise<void> {
  try {
    const result = FeeBumpSchema.safeParse(req.body);

    if (!result.success) {
      console.warn(
        "Validation failed for fee-bump request:",
        result.error.format(),
      );

      return next(
        new AppError(
          `Validation failed: ${JSON.stringify(result.error.format())}`,
          400,
          "INVALID_XDR",
        ),
      );
    }

    const body: FeeBumpRequest = result.data;
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

    if (!innerTransaction.signatures || innerTransaction.signatures.length === 0) {
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

    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      res.status(500).json({
        error: "Missing tenant context for fee sponsorship",
      });
      return;
    }

    const tenant = syncTenantFromApiKey(apiKeyConfig);
    
    // 🛠️ Fixed: Added 'await' here
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

    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feePayerAccount.keypair,
      feeAmount.toString(),
      innerTransaction,
      config.networkPassphrase,
    );

    feeBumpTx.sign(feePayerAccount.keypair);
    recordSponsoredTransaction(tenant.id, feeAmount);

    const feeBumpXdr = feeBumpTx.toXDR();
    console.log(
      `Fee-bump transaction created | fee_payer: ${feePayerAccount.publicKey}`,
    );

    const submit = body.submit || false;
    if (submit && config.horizonUrl) {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);

      try {
        const submissionResult = await server.submitTransaction(feeBumpTx);
        
        // 🛠️ Fixed: Added tenant.id as the second parameter
        transactionStore.addTransaction(submissionResult.hash, tenant.id, "submitted");

        const response: FeeBumpResponse = {
          xdr: feeBumpXdr,
          status: "submitted",
          hash: submissionResult.hash,
          fee_payer: feePayerAccount.publicKey,
        };

        broadcastUpdate({
          timestamp: new Date().toISOString(),
          status: response.status,
          innerHash: submissionResult.hash,
          costStroops: feeAmount,
          tenant: tenant.id,
        });

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

    broadcastUpdate({
      timestamp: new Date().toISOString(),
      status: response.status,
      innerHash: "Simulated-Live-Hash-" + Math.floor(Math.random() * 1000000),
      costStroops: feeAmount,
      tenant: tenant.id,
    });

    res.json(response);
  } catch (error: any) {
    console.error("Error processing fee-bump request:", error);
    next(error);
  }
}