import { NextFunction, Request, Response } from "express";
import StellarSdk from "@stellar/stellar-sdk";
import { Config, pickFeePayerAccount } from "../config";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { syncTenantFromApiKey } from "../models/tenantStore";
import { recordSponsoredTransaction } from "../models/transactionLedger";
import { FeeBumpRequest, FeeBumpSchema } from "../schemas/feeBump";
import { checkTenantDailyQuota } from "../services/quota";
import { transactionStore } from "../workers/transactionStore";

import { calculateFeeBumpFee } from "../utils/feeCalculator";
import { signTransaction, signTransactionWithVault } from "../signing";

interface FeeBumpResponse {
  xdr: string;
  status: string;
  hash?: string;
  fee_payer: string;
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

    // Pick a fee payer account using Round Robin
    const feePayerAccount = pickFeePayerAccount(config);
    console.log(
      `Received fee-bump request | fee_payer: ${feePayerAccount.publicKey}`
    );

    let innerTransaction: any;
    try {
      innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
        body.xdr,
        config.networkPassphrase
      );
    } catch (error: any) {
      console.error("Failed to parse XDR:", error.message);
      return next(
        new AppError(`Invalid XDR: ${error.message}`, 400, "INVALID_XDR"),
      );
    }

    // Safety check: Reject transactions with too many operations (DoS protection)
    const operationCount = innerTransaction.operations?.length || 0;
    if (operationCount > config.maxOperations) {
      console.warn(
        `Transaction has too many operations: ${operationCount} (max: ${config.maxOperations})`,
      );
      return next(
        new AppError(
          `Transaction contains ${operationCount} operations, which exceeds the maximum allowed ${config.maxOperations}`,
          400,
          "TOO_MANY_OPERATIONS",
        ),
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

    if ("feeBumpTransaction" in innerTransaction) {
      return next(
        new AppError(
          "Cannot fee-bump an already fee-bumped transaction",
          400,
          "ALREADY_FEE_BUMPED",
        ),
      );
    }

    const baseFeeAmount = Math.floor(config.baseFee * config.feeMultiplier);

    // Use extracted utility for correct fee calculation
    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      res.status(500).json({
        error: "Missing tenant context for fee sponsorship",
      });
      return;
    }
    // Extract operation count safely
    const operationCount = innerTransaction.operations?.length || 0;
    const feeAmount = calculateFeeBumpFee(
      operationCount,
      config.baseFee,
      config.feeMultiplier
    );

    console.log("Fee calculation:", {
      operationCount,
      baseFee: config.baseFee,
      multiplier: config.feeMultiplier,
      finalFee: feeAmount,
    });

    const tenant = syncTenantFromApiKey(apiKeyConfig);
    const quotaCheck = checkTenantDailyQuota(tenant, feeAmount);
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
      feeAmount,
      innerTransaction,
      config.networkPassphrase
    );

    if (feePayerAccount.secretSource.type === "env") {
      await signTransaction(feeBumpTx, feePayerAccount.secretSource.secret);
    } else {
      if (!config.vault) {
        throw new Error("Vault config missing for vault-backed fee payer signing");
      }

      await signTransactionWithVault(
        feeBumpTx,
        feePayerAccount.publicKey,
        config.vault,
        feePayerAccount.secretSource.secretPath
      );
    }

    recordSponsoredTransaction(tenant.id, feeAmount);

    const feeBumpXdr = feeBumpTx.toXDR();
    console.log(
      `Fee-bump transaction created | fee_payer: ${feePayerAccount.publicKey}`
    );

    const submit = body.submit || false;
    const status = submit ? "submitted" : "ready";

    if (submit && config.horizonUrl) {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);

      server
        .submitTransaction(feeBumpTx)
        .then((result: any) => {
          transactionStore.addTransaction(result.hash, "submitted");

          const response: FeeBumpResponse = {
            xdr: feeBumpXdr,
            status: "submitted",
            hash: result.hash,
            fee_payer: feePayerAccount.publicKey,
          };
          res.json(response);
        })
        .catch((error: any) => {
          console.error("Transaction submission failed:", error);
          next(
            new AppError(
              `Transaction submission failed: ${error.message}`,
              500,
              "SUBMISSION_FAILED",
            ),
          );
        });
      return;
      return;
    }

    const response: FeeBumpResponse = {
      xdr: feeBumpXdr,
      status,
      fee_payer: feePayerAccount.publicKey,
    };
    res.json(response);
  } catch (error: any) {
    console.error("Error processing fee-bump request:", error);
    next(error);
  }
}
