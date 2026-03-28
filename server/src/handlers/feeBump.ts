import StellarSdk, { Transaction } from "@stellar/stellar-sdk";
import { Config, FeePayerAccount, pickFeePayerAccount } from "../config";
import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { Tenant, syncTenantFromApiKey } from "../models/tenantStore";
import { recordSponsoredTransaction } from "../models/transactionLedger";
import { FeeBumpRequest, FeeBumpSchema, FeeBumpBatchRequest, FeeBumpBatchSchema } from "../schemas/feeBump";
import { checkTenantDailyQuota } from "../services/quota";
import { calculateFeeBumpFee } from "../utils/feeCalculator";
import { verifyXdrNetwork } from "../utils/networkVerification";
import { MockPriceOracle, validateSlippage } from "../utils/priceOracle";
import { transactionMilestoneService } from "../services/discordMilestones";
import { transactionStore } from "../workers/transactionStore";
import { prisma } from "../utils/db";

/**
 * @openapi
 * /fee-bump:
 *   post:
 *     summary: Wrap a transaction with a fee-bump envelope
 *     description: >
 *       Accepts a signed Stellar inner transaction XDR and returns a
 *       fee-bumped version signed by the Fluid fee-payer account.
 *       Optionally submits the transaction directly to Horizon.
 *     tags:
 *       - Fee Bump
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FeeBumpRequest'
 *           examples:
 *             minimal:
 *               summary: Wrap only (no submission)
 *               value:
 *                 xdr: "AAAAAgAAAAB..."
 *                 submit: false
 *             submit:
 *               summary: Wrap and submit to Horizon
 *               value:
 *                 xdr: "AAAAAgAAAAB..."
 *                 submit: true
 *     responses:
 *       200:
 *         description: Fee-bumped transaction XDR (and hash if submitted).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FeeBumpResponse'
 *             examples:
 *               ready:
 *                 summary: XDR ready for client submission
 *                 value:
 *                   xdr: "AAAABQAAAABf..."
 *                   status: ready
 *                   fee_payer: "GABC...XYZ"
 *               submitted:
 *                 summary: Submitted to Horizon
 *                 value:
 *                   xdr: "AAAABQAAAABf..."
 *                   status: submitted
 *                   hash: "a1b2c3..."
 *                   fee_payer: "GABC...XYZ"
 *       400:
 *         description: >
 *           Invalid request — bad XDR, unsigned transaction, wrong network,
 *           unsupported asset, or slippage exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidXdr:
 *                 summary: Malformed XDR
 *                 value:
 *                   error: "Invalid XDR: ..."
 *                   code: INVALID_XDR
 *               unsignedTx:
 *                 summary: Transaction not signed
 *                 value:
 *                   error: "Inner transaction must be signed before fee-bumping"
 *                   code: INVALID_XDR
 *       401:
 *         description: Missing API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingKey:
 *                 summary: No x-api-key header
 *                 value:
 *                   error: "Missing API key. Provide a valid x-api-key header to access this endpoint."
 *                   code: AUTH_FAILED
 *       403:
 *         description: Invalid/revoked API key or daily quota exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               quotaExceeded:
 *                 summary: Tier quota exhausted
 *                 value:
 *                   error: "Tier limit exceeded. Spend 1000000/500000 stroops..."
 *                   code: QUOTA_EXCEEDED
 *       500:
 *         description: Internal server error or Horizon submission failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               submissionFailed:
 *                 summary: Horizon rejected the transaction
 *                 value:
 *                   error: "Transaction submission failed: ..."
 *                   code: SUBMISSION_FAILED
 *
 * /fee-bump/batch:
 *   post:
 *     summary: Wrap multiple transactions in a single request
 *     description: >
 *       Accepts an array of signed inner transaction XDRs and returns
 *       fee-bumped versions for each, processed concurrently.
 *     tags:
 *       - Fee Bump
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FeeBumpBatchRequest'
 *     responses:
 *       200:
 *         description: Array of fee-bump results, one per input XDR.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/FeeBumpResponse'
 *       400:
 *         description: Validation error on one or more XDRs.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export interface FeeBumpResponse {
  xdr: string;
  status: "ready" | "submitted";
  hash?: string;
  fee_payer: string;
  submitted_via?: string;
  submission_attempts?: number;
}

async function maybeNotifyMilestones(): Promise<void> {
  try {
    await transactionMilestoneService.checkForMilestones();
  } catch (error) {
    console.error("Discord milestone check failed:", error);
  }
}

async function processFeeBump(
  xdr: string,
  submit: boolean,
  config: Config,
  tenant: Tenant,
  feePayerAccount: FeePayerAccount
): Promise<FeeBumpResponse> {
  let innerTransaction: Transaction;

  try {
    innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
      xdr,
      config.networkPassphrase
    ) as Transaction;
  } catch (error: any) {
    throw new AppError(`Invalid XDR: ${error.message}`, 400, "INVALID_XDR");
  }

  if (!innerTransaction.signatures || innerTransaction.signatures.length === 0) {
    throw new AppError(
      "Inner transaction must be signed before fee-bumping",
      400,
      "UNSIGNED_TRANSACTION"
    );
  }

  if ("innerTransaction" in innerTransaction) {
    throw new AppError(
      "Cannot fee-bump an already fee-bumped transaction",
      400,
      "ALREADY_FEE_BUMPED"
    );
  }

  const operationCount = innerTransaction.operations?.length || 0;
  const feeAmount = calculateFeeBumpFee(
    innerTransaction, // Pass the transaction object for Soroban check
    config.baseFee,
    config.feeMultiplier
  );

  const quotaCheck = await checkTenantDailyQuota(tenant, feeAmount);
  if (!quotaCheck.allowed) {
    throw new AppError(
      `Tier limit exceeded. Spend ${quotaCheck.currentSpendStroops}/${quotaCheck.dailyQuotaStroops} stroops and transactions ${quotaCheck.currentTxCount}/${quotaCheck.txLimit} today.`,
      403,
      "QUOTA_EXCEEDED"
    );
  }

  const innerTxHash = innerTransaction.hash().toString("hex");

  // Create transaction record with PENDING status
  const transactionRecord = await prisma.transaction.create({
    data: {
      innerTxHash,
      tenantId: tenant.id,
      status: "PENDING",
      costStroops: feeAmount,
    },
  });

  try {
    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feePayerAccount.keypair,
      feeAmount.toString(),
      innerTransaction,
      config.networkPassphrase
    );

    feeBumpTx.sign(feePayerAccount.keypair);
    await recordSponsoredTransaction(tenant.id, feeAmount);
    await maybeNotifyMilestones();

    const feeBumpXdr = feeBumpTx.toXDR();
    const feeBumpTxHash = feeBumpTx.hash().toString("hex");

    if (submit && config.horizonUrl) {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);

      try {
        const submissionResult = await server.submitTransaction(feeBumpTx);
        await transactionStore.addTransaction(submissionResult.hash, tenant.id, "submitted");

        await prisma.transaction.update({
          where: { id: transactionRecord.id },
          data: {
            status: "SUCCESS",
            txHash: submissionResult.hash,
          },
        });

        return {
          xdr: feeBumpXdr,
          status: "submitted",
          hash: submissionResult.hash,
          fee_payer: feePayerAccount.publicKey,
        };
      } catch (error: any) {
        console.error("Transaction submission failed:", error);

        // Update transaction record to FAILED
        await prisma.transaction.update({
          where: { id: transactionRecord.id },
          data: {
            status: "FAILED",
          },
        });

        throw new AppError(
          `Transaction submission failed: ${error.message}`,
          500,
          "SUBMISSION_FAILED"
        );
      }
    }

    // Update transaction record to SUCCESS for non-submitted transactions
    await prisma.transaction.update({
      where: { id: transactionRecord.id },
      data: {
        status: "SUCCESS",
        txHash: feeBumpTxHash,
      },
    });

    return {
      xdr: feeBumpXdr,
      status: submit ? "submitted" : "ready",
      fee_payer: feePayerAccount.publicKey,
    };
  } catch (error: any) {
    // Update transaction record to FAILED for any other errors
    await prisma.transaction.update({
      where: { id: transactionRecord.id },
      data: {
        status: "FAILED",
      },
    });

    throw error;
  }
}

export async function feeBumpHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  config: Config
): Promise<void> {
  try {
    const result = FeeBumpSchema.safeParse(req.body);

    if (!result.success) {
      console.warn(
        "Validation failed for fee-bump request:",
        result.error.format()
      );

      return next(
        new AppError(
          `Validation failed: ${JSON.stringify(result.error.format())}`,
          400,
          "INVALID_XDR"
        )
      );
    }

    const body: FeeBumpRequest = result.data;

    // Validate XDR early so errors surface before touching the signer pool
    let parsedInner: Transaction;
    try {
      parsedInner = StellarSdk.TransactionBuilder.fromXDR(
        body.xdr,
        config.networkPassphrase
      ) as Transaction;
    } catch (err: any) {
      return next(new AppError(`Invalid XDR: ${err.message}`, 400, "INVALID_XDR"));
    }
    if ("innerTransaction" in parsedInner) {
      return next(new AppError("Cannot fee-bump an already fee-bumped transaction", 400, "ALREADY_FEE_BUMPED"));
    }

    // Verify the XDR was signed for the server's configured network
    const networkCheck = verifyXdrNetwork(body.xdr, config.networkPassphrase);
    if (!networkCheck.valid) {
      return next(new AppError(networkCheck.errorMessage ?? "Network mismatch", 400, "NETWORK_MISMATCH"));
    }

    // Check against token whitelist if a token is provided
    if (body.token) {
      const supportedAssets = config.supportedAssets ?? [];
      const isWhitelisted = supportedAssets.some((asset) => {
        const assetId = asset.issuer ? `${asset.code}:${asset.issuer}` : asset.code;
        return body.token === assetId;
      });

      if (!isWhitelisted) {
        console.warn(`Rejected fee-bump request for non-whitelisted asset: ${body.token}`);
        return next(
          new AppError(
            `Whitelisting failed: Asset "${body.token}" is not accepted for fee sponsorship.`,
            400,
            "UNSUPPORTED_ASSET",
          ),
        );
      }
      console.log(`Accepted whitelisted asset: ${body.token}`);

      // Slippage protection for token payments
      if (body.maxSlippage !== undefined) {
        const priceOracle = new MockPriceOracle();
        const requestTime = Date.now();
        try {
          const currentPrice = await priceOracle.getCurrentPrice(body.token);
          const historicalPrice = await priceOracle.getHistoricalPrice(body.token, requestTime - 120000);
          const slippageCheck = validateSlippage(historicalPrice, currentPrice, body.maxSlippage);
          if (!slippageCheck.valid) {
            return next(new AppError("Slippage too high: try increasing your fee payment", 400, "SLIPPAGE_TOO_HIGH"));
          }
        } catch (error: any) {
          return next(new AppError(`Failed to verify token price: ${error.message}`, 500, "INTERNAL_ERROR"));
        }
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
    const feePayerAccount = pickFeePayerAccount(config);

    const response = await processFeeBump(
      body.xdr,
      body.submit || false,
      config,
      tenant,
      feePayerAccount
    );

    res.json(response);
  } catch (error: any) {
    console.error("Error processing fee-bump request:", error);
    next(error);
  }
}

export async function feeBumpBatchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  config: Config
): Promise<void> {
  try {
    const parsedBody = FeeBumpBatchSchema.safeParse(req.body);

    if (!parsedBody.success) {
      console.warn(
        "Validation failed for fee-bump batch request:",
        parsedBody.error.format()
      );

      return next(
        new AppError(
          `Validation failed: ${JSON.stringify(parsedBody.error.format())}`,
          400,
          "INVALID_XDR"
        )
      );
    }

    const body: FeeBumpBatchRequest = parsedBody.data;

    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      res.status(500).json({ error: "Missing tenant context for fee sponsorship" });
      return;
    }

    const tenant = syncTenantFromApiKey(apiKeyConfig);
    const feePayerAccount = pickFeePayerAccount(config);
    const results: FeeBumpResponse[] = await Promise.all(
      body.xdrs.map((xdr) => processFeeBump(xdr, body.submit ?? false, config, tenant, feePayerAccount))
    );

    res.json(results);
  } catch (error: any) {
    console.error("Error processing fee-bump batch request:", error);
    next(error);
  }
}

