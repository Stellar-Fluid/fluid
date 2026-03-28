/**
 * Sandbox handlers
 *
 * POST /sandbox/reset  — wipe sandbox transaction history and re-fund the
 *                        sandbox fee-payer account via Friendbot (or the
 *                        configured Quickstart faucet).
 * GET  /sandbox/status — return sandbox metadata for the calling API key.
 *
 * Both endpoints require a sandbox API key (isSandbox === true).
 */

import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import prisma from "../utils/db";
import { createLogger } from "../utils/logger";
import { invalidateApiKeyCache } from "../utils/redis";

const logger = createLogger("sandbox");

const SANDBOX_HORIZON_URL =
  process.env.SANDBOX_HORIZON_URL ?? "http://localhost:8000";

const SANDBOX_RATE_LIMIT_MAX = Number(
  process.env.SANDBOX_RATE_LIMIT_MAX ?? "10",
);

/**
 * Fund an account via Friendbot / Quickstart faucet.
 * Returns true on success, false if the network call fails (non-fatal).
 */
async function fundViaSandboxFaucet(publicKey: string): Promise<boolean> {
  try {
    const url = `${SANDBOX_HORIZON_URL}/friendbot?addr=${encodeURIComponent(publicKey)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      logger.warn(
        { publicKey, status: res.status },
        "Friendbot returned non-OK status",
      );
      return false;
    }
    logger.info({ publicKey }, "Sandbox account funded via Friendbot");
    return true;
  } catch (err) {
    logger.warn(
      { err, publicKey },
      "Friendbot call failed (sandbox may be offline)",
    );
    return false;
  }
}

/**
 * Wipe all SponsoredTransaction rows for the tenant and re-fund the
 * sandbox fee-payer account.
 */
export async function sandboxResetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      return next(
        new AppError("Missing API key context", 500, "INTERNAL_ERROR"),
      );
    }

    if (!apiKeyConfig.isSandbox) {
      return next(
        new AppError(
          "This endpoint is only available for sandbox API keys.",
          403,
          "SANDBOX_ONLY",
        ),
      );
    }

    const tenantId = apiKeyConfig.tenantId;

    // 1. Delete all sponsored transactions for this tenant
    const deleted = await (prisma as any).sponsoredTransaction.deleteMany({
      where: { tenantId },
    });

    // 2. Reset daily quota usage by updating the tenant's quota tracking
    //    (quota is computed from SponsoredTransaction rows, so deleting them
    //     is sufficient — no extra field to reset)

    // 3. Re-fund the sandbox fee-payer via Friendbot
    const keyRecord = await (prisma as any).apiKey.findUnique({
      where: { key: apiKeyConfig.key },
      select: { sandboxFeePayerSecret: true, id: true },
    });

    let funded = false;
    let sandboxPublicKey: string | null = null;

    if (keyRecord?.sandboxFeePayerSecret) {
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.fromSecret(keyRecord.sandboxFeePayerSecret);
      sandboxPublicKey = kp.publicKey();
      funded = await fundViaSandboxFaucet(sandboxPublicKey);
    }

    // 4. Stamp the reset time
    await (prisma as any).apiKey.update({
      where: { key: apiKeyConfig.key },
      data: { sandboxLastResetAt: new Date() },
    });

    // 5. Invalidate Redis cache so the updated record is re-read
    await invalidateApiKeyCache(apiKeyConfig.key);

    logger.info(
      { tenantId, deletedTxCount: deleted.count, funded },
      "Sandbox reset complete",
    );

    res.json({
      ok: true,
      tenantId,
      deletedTransactions: deleted.count,
      sandboxPublicKey,
      funded,
      resetAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Return sandbox status for the calling API key.
 */
export async function sandboxStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      return next(
        new AppError("Missing API key context", 500, "INTERNAL_ERROR"),
      );
    }

    if (!apiKeyConfig.isSandbox) {
      return next(
        new AppError(
          "This endpoint is only available for sandbox API keys.",
          403,
          "SANDBOX_ONLY",
        ),
      );
    }

    const keyRecord = await (prisma as any).apiKey.findUnique({
      where: { key: apiKeyConfig.key },
      select: {
        sandboxLastResetAt: true,
        sandboxFeePayerSecret: true,
        createdAt: true,
      },
    });

    let sandboxPublicKey: string | null = null;
    if (keyRecord?.sandboxFeePayerSecret) {
      const { Keypair } = await import("@stellar/stellar-sdk");
      sandboxPublicKey = Keypair.fromSecret(
        keyRecord.sandboxFeePayerSecret,
      ).publicKey();
    }

    // Count transactions since last reset
    const txCount = await (prisma as any).sponsoredTransaction.count({
      where: { tenantId: apiKeyConfig.tenantId },
    });

    res.json({
      isSandbox: true,
      tenantId: apiKeyConfig.tenantId,
      sandboxPublicKey,
      sandboxHorizonUrl: SANDBOX_HORIZON_URL,
      sandboxRateLimitMax: SANDBOX_RATE_LIMIT_MAX,
      lastResetAt: keyRecord?.sandboxLastResetAt ?? null,
      transactionsSinceReset: txCount,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin handler: create a sandbox API key for a tenant.
 * POST /admin/sandbox/api-keys
 */
export async function createSandboxApiKeyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminToken = req.header("x-admin-token");
    if (!adminToken || adminToken !== process.env.FLUID_ADMIN_TOKEN) {
      return next(new AppError("Unauthorized", 401, "AUTH_FAILED"));
    }

    const { tenantId, name } = req.body as {
      tenantId?: string;
      name?: string;
    };

    if (!tenantId) {
      return next(
        new AppError("tenantId is required", 400, "VALIDATION_ERROR"),
      );
    }

    // Generate a sandbox keypair for this key
    const { Keypair } = await import("@stellar/stellar-sdk");
    const sandboxKeypair = Keypair.random();

    // Generate the API key string
    const { randomBytes } = await import("crypto");
    const rawKey = `sbx_${randomBytes(24).toString("hex")}`;
    const prefix = rawKey.slice(0, 8);

    const record = await (prisma as any).apiKey.create({
      data: {
        key: rawKey,
        prefix,
        name: name ?? "Sandbox Key",
        tenantId,
        isSandbox: true,
        sandboxFeePayerSecret: sandboxKeypair.secret(),
        // Sandbox gets lower rate limits
        maxRequests: SANDBOX_RATE_LIMIT_MAX,
        windowMs: 60_000,
        dailyQuotaStroops: 500_000, // 0.05 XLM
      },
    });

    // Attempt initial Friendbot funding
    const funded = await fundViaSandboxFaucet(sandboxKeypair.publicKey());

    logger.info(
      { tenantId, keyId: record.id, funded },
      "Sandbox API key created",
    );

    res.status(201).json({
      id: record.id,
      key: rawKey, // returned once — store it securely
      prefix,
      isSandbox: true,
      sandboxPublicKey: sandboxKeypair.publicKey(),
      sandboxHorizonUrl: SANDBOX_HORIZON_URL,
      funded,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Perform a reset for all sandbox keys whose last reset was > 24 h ago.
 * Called by the daily auto-reset worker.
 */
export async function autoResetStaleSandboxKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const staleKeys = await (prisma as any).apiKey.findMany({
    where: {
      isSandbox: true,
      active: true,
      OR: [
        { sandboxLastResetAt: null },
        { sandboxLastResetAt: { lt: cutoff } },
      ],
    },
    select: {
      key: true,
      tenantId: true,
      sandboxFeePayerSecret: true,
    },
  });

  let resetCount = 0;

  for (const record of staleKeys) {
    try {
      await (prisma as any).sponsoredTransaction.deleteMany({
        where: { tenantId: record.tenantId },
      });

      if (record.sandboxFeePayerSecret) {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const pk = Keypair.fromSecret(record.sandboxFeePayerSecret).publicKey();
        await fundViaSandboxFaucet(pk);
      }

      await (prisma as any).apiKey.update({
        where: { key: record.key },
        data: { sandboxLastResetAt: new Date() },
      });

      await invalidateApiKeyCache(record.key);
      resetCount++;
    } catch (err) {
      logger.error(
        { err, key: record.key },
        "Auto-reset failed for sandbox key",
      );
    }
  }

  logger.info({ resetCount }, "Sandbox auto-reset complete");
  return resetCount;
}
