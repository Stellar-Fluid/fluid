/**
 * sandboxGuard middleware
 *
 * Enforces lower rate limits for sandbox API keys.
 * Must be placed AFTER apiKeyMiddleware so res.locals.apiKey is populated.
 *
 * Sandbox keys get SANDBOX_RATE_LIMIT_MAX requests per window (default 10)
 * vs the production tier limit.
 */

import { NextFunction, Request, Response } from "express";
import { ApiKeyConfig } from "./apiKeys";
import { incrWithExpiry } from "../utils/redis";

const SANDBOX_RATE_LIMIT_MAX = Number(
  process.env.SANDBOX_RATE_LIMIT_MAX ?? "10",
);

// In-memory fallback for sandbox rate limiting
const sandboxUsage = new Map<string, { count: number; resetTime: number }>();

export async function sandboxRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;

  // Only apply to sandbox keys
  if (!apiKeyConfig?.isSandbox) {
    return next();
  }

  const limit = SANDBOX_RATE_LIMIT_MAX;
  const windowMs = apiKeyConfig.windowMs || 60_000;
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const redisKey = `sbx_rl:${apiKeyConfig.key}`;

  try {
    const result = await incrWithExpiry(redisKey, windowSeconds);
    if (result) {
      const { count, ttl } = result;
      res.setHeader("X-Sandbox-RateLimit-Limit", limit.toString());
      res.setHeader(
        "X-Sandbox-RateLimit-Remaining",
        Math.max(limit - count, 0).toString(),
      );
      res.setHeader(
        "X-Sandbox-RateLimit-Reset",
        Math.ceil(Date.now() / 1000 + ttl).toString(),
      );

      if (count > limit) {
        res.status(429).json({
          error: `Sandbox rate limit exceeded (${limit} req/min). Reset your sandbox or wait for the window to expire.`,
          code: "SANDBOX_RATE_LIMITED",
          limit,
          retryAfterSeconds: Math.max(ttl, 0),
        });
        return;
      }
      return next();
    }
  } catch {
    // fall through to in-memory
  }

  // In-memory fallback
  const now = Date.now();
  const entry = sandboxUsage.get(apiKeyConfig.key);
  if (!entry || now >= entry.resetTime) {
    sandboxUsage.set(apiKeyConfig.key, { count: 1, resetTime: now + windowMs });
    return next();
  }
  if (entry.count >= limit) {
    res.status(429).json({
      error: `Sandbox rate limit exceeded (${limit} req/min).`,
      code: "SANDBOX_RATE_LIMITED",
      limit,
      retryAfterSeconds: Math.max(Math.ceil((entry.resetTime - now) / 1000), 0),
    });
    return;
  }
  entry.count++;
  next();
}
