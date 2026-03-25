import { NextFunction, Request, Response } from "express";
import StellarSdk from "@stellar/stellar-sdk";
import { Config } from "../config";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { syncTenantFromApiKey } from "../models/tenantStore";
import { recordSponsoredTransaction } from "../models/transactionLedger";
import { FeeBumpRequest, FeeBumpSchema } from "../schemas/feeBump";
import { checkTenantDailyQuota } from "../services/quota";
import { calculateFeeBumpFee } from "../utils/feeCalculator";
import { getHorizonFailoverClient } from "../horizon/failoverClient";
import { transactionStore } from "../workers/transactionStore";
import { nativeSigner } from "../signing/native";

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
  next: NextFunction
): Promise<void> {
  try {
    const parsedBody = FeeBumpSchema.safeParse(req.body);

    if (!parsedBody.success) {
      console.warn(
        "Validation failed for fee-bump request:",
        parsedBody.error.format()
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
    const signerLease = await config.signerPool.acquire();
    const feePayerAccount = signerLease.account;
    console.log(`Received fee-bump request | fee_payer: ${feePayerAccount.publicKey}`);

    try {
      let innerTransaction: any;
      try {
        innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
          body.xdr,
          config.networkPassphrase
        ) as any;
      } catch (error: any) {
        console.error("Failed to parse XDR:", error.message);
        return next(
          new AppError(`Invalid XDR: ${error.message}`, 400, "INVALID_XDR")
        );
      }

      // Preflight simulation for Soroban transactions
      const isSoroban = innerTransaction.operations.some(
        (op: any) =>
          ["invokeHostFunction", "extendFootprintTtl", "restoreFootprint"].includes(op.type)
      );

      if (isSoroban) {
        if (!config.stellarRpcUrl) {
          return next(
            new AppError(
              "Soroban transaction requires STELLAR_RPC_URL for preflight simulation",
              400,
              "MISSING_RPC_URL"
            )
          );
        }

        try {
          console.log("[soroban] preflight simulation started");
          const updatedXdr = await nativeSigner.preflightSoroban(
            config.stellarRpcUrl,
            body.xdr
          );
          
          // Use the updated XDR containing returned footprints and corrected resource fees
          innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
            updatedXdr,
            config.networkPassphrase
          ) as any;
          
          console.log("[soroban] preflight simulation successful, transaction updated with correct resource fees and footprints");
        } catch (simError: any) {
          console.error("[soroban] simulation failed:", simError.message);
          // Handle simulation failures as suggested: rejecting the bump request
          return next(
            new AppError(
              `Soroban simulation failed: ${simError.message}. The transaction would fail on-chain or out of gas.`,
              400,
              "SIMULATION_FAILED"
            )
          );
        }
      }

      if (!innerTransaction.signatures || innerTransaction.signatures.length === 0) {
        return next(
          new AppError(
            "Inner transaction must be signed before fee-bumping",
            400,
            "UNSIGNED_TRANSACTION"
          )
        );
      }

      if ("innerTransaction" in innerTransaction) {
        return next(
          new AppError(
            "Cannot fee-bump an already fee-bumped transaction",
            400,
            "ALREADY_FEE_BUMPED"
          )
        );
      }

      const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
      if (!apiKeyConfig) {
        return next(
          new AppError(
            "Missing tenant context for fee sponsorship",
            500,
            "INTERNAL_ERROR"
          )
        );
      }

      const tenant = syncTenantFromApiKey(apiKeyConfig);
      const operationCount = innerTransaction.operations?.length || 0;
      const innerFee = parseInt(innerTransaction.fee || "0", 10);
      
      const calculatedBaseFee = calculateFeeBumpFee(
        operationCount,
        config.baseFee,
        config.feeMultiplier
      );

      // Fee-bump fee must be higher than the inner transaction fee.
      // For Soroban, the inner transaction fee includes resource fees returned by simulation.
      const feeAmount = Math.max(calculatedBaseFee, innerFee + config.baseFee);
      
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

      console.log("Fee calculation:", {
        operationCount,
        baseFee: config.baseFee,
        multiplier: config.feeMultiplier,
        finalFee: feeAmount,
      });

      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feePayerAccount.keypair,
        feeAmount.toString(),
        innerTransaction,
        config.networkPassphrase
      );


    //const baseFeeAmount = Math.floor(config.baseFee * config.feeMultiplier);

    // Use extracted utility for correct fee calculation
    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      res.status(500).json({
        error: "Missing tenant context for fee sponsorship",
      });
      return;
    }
    // Extract operation count safely
    
    const feeAmount = calculateFeeBumpFee(
  innerTransaction,
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

      feeBumpTx.sign(feePayerAccount.keypair);
      recordSponsoredTransaction(tenant.id, feeAmount);

      const feeBumpXdr = feeBumpTx.toXDR();
      console.log(
        `Fee-bump transaction created | fee_payer: ${feePayerAccount.publicKey}`
      );


      if (!body.submit) {
        const response: FeeBumpResponse = {
          xdr: feeBumpXdr,
          status: "ready",
          fee_payer: feePayerAccount.publicKey,
        };
        res.json(response);
        return;
      }

      if (config.horizonUrls.length === 0) {
        return next(
          new AppError(
            "Transaction submission requested but no Horizon URLs are configured",
            500,
            "SUBMISSION_FAILED"
          )
        );
      }

      const horizonClient = getHorizonFailoverClient();
      if (!horizonClient) {
        return next(
          new AppError(
            "Horizon failover client is not initialized",
            500,
            "SUBMISSION_FAILED"
          )
        );
      }

      try {
        const submission = await horizonClient.submitTransaction(feeBumpTx);
        transactionStore.addTransaction(submission.result.hash, "submitted");

        const response: FeeBumpResponse = {
          xdr: feeBumpXdr,
          status: "submitted",
          hash: submission.result.hash,
          fee_payer: feePayerAccount.publicKey,
          submitted_via: submission.nodeUrl,
          submission_attempts: submission.attempts,
        };
        res.json(response);
      } catch (error: any) {
        console.error("Transaction submission failed:", error);
        return next(
          new AppError(
            `Transaction submission failed: ${error.message}`,
            500,
            "SUBMISSION_FAILED"
          )
        );
      }
    } finally {
      await signerLease.release();
    }
  } catch (error) {
    console.error("Error processing fee-bump request:", error);
    next(error);
  }
}
