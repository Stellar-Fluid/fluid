import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";
import prisma from "../utils/db";
import {
  getCachedApiKey,
  setCachedApiKey,
  invalidateApiKeyCache,
} from "../utils/redis";
import {
  SubscriptionTierCode,
  SubscriptionTierName,
  toTierCode,
} from "../models/subscriptionTier";

export interface ApiKeyConfig {
  key: string;
  tenantId: string;
  name: string;
  tier: SubscriptionTierCode;
  tierName: SubscriptionTierName;
  tierId: string;
  txLimit: number;
  rateLimit: number;
  priceMonthly: number;
  maxRequests: number;
  windowMs: number;
  dailyQuotaStroops: number;
  isSandbox: boolean;
}

const API_KEYS = new Map<string, ApiKeyConfig>();

function getApiKeyFromHeader(req: Request): string | undefined {
  const headerValue = req.header("x-api-key");
  if (typeof headerValue !== "string") return undefined;
  const apiKey = headerValue.trim();
  return apiKey.length > 0 ? apiKey : undefined;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}***`;
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export async function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = getApiKeyFromHeader(req);

  if (!apiKey) {
    return next(
      new AppError(
        "Missing API key. Provide a valid x-api-key header to access this endpoint.",
        401,
        "AUTH_FAILED",
      ),
    );
  }

  // 1) Try Redis cache first
  try {
    const cached = await getCachedApiKey(apiKey);
    if (cached) {
      // Cache stores the ApiKeyConfig as a JSON string
      // eslint-disable-next-line no-console
      console.log("[Redis] Cache Hit for API key:", maskApiKey(apiKey));

      res.locals.apiKey = JSON.parse(cached) as ApiKeyConfig;
      return next();
    }
  } catch (err) {
    // If Redis fails, fall back to DB/in-memory lookup below.
  }

  // 2) Try DB (Prisma) lookup
  try {
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: {
        tenant: {
          include: {
            subscriptionTier: true,
          },
        },
      },
    });

    if (keyRecord) {
      // Reject revoked keys immediately
      if (!keyRecord.active) {
        return next(
          new AppError("API key has been revoked.", 403, "AUTH_FAILED"),
        );
      }

      const tierRecord = keyRecord.tenant?.subscriptionTier;
      const resolvedTierName = (tierRecord?.name ??
        "Free") as SubscriptionTierName;
      const resolvedRateLimit = tierRecord?.rateLimit ?? keyRecord.maxRequests;

      const apiKeyConfig: ApiKeyConfig = {
        key: keyRecord.key,
        tenantId: keyRecord.tenantId,
        name: keyRecord.name ?? keyRecord.tenant?.name ?? keyRecord.prefix,
        tier: toTierCode(resolvedTierName),
        tierName: resolvedTierName,
        tierId: tierRecord?.id ?? `tier-${toTierCode(resolvedTierName)}`,
        txLimit: tierRecord?.txLimit ?? 10,
        rateLimit: resolvedRateLimit,
        priceMonthly: tierRecord?.priceMonthly ?? 0,
        maxRequests: resolvedRateLimit,
        windowMs: keyRecord.windowMs,
        dailyQuotaStroops: Number(keyRecord.dailyQuotaStroops),
        isSandbox: keyRecord.isSandbox ?? false,
      };

      // Cache the key for future requests. Non-blocking: don't fail the request on cache errors.
      setCachedApiKey(apiKey, JSON.stringify(apiKeyConfig), 300).catch(
        () => {},
      );

      res.locals.apiKey = apiKeyConfig;
      return next();
    }
  } catch (err) {
    // DB error — continue to in-memory fallback
  }

  // 3) In-memory fallback (useful for local dev / tests)
  const apiKeyConfig = API_KEYS.get(apiKey);

  if (!apiKeyConfig) {
    return next(new AppError("Invalid API key.", 403, "AUTH_FAILED"));
  }

  // Cache in Redis asynchronously for future hits
  setCachedApiKey(apiKey, JSON.stringify(apiKeyConfig), 300).catch(() => {});

  res.locals.apiKey = apiKeyConfig;
  next();
}

export function listApiKeys(): ApiKeyConfig[] {
  return Array.from(API_KEYS.values());
}

// Expose an invalidate helper so other parts of the app can clear cache after updates.
export async function invalidateCachedApiKey(apiKey: string): Promise<void> {
  try {
    await invalidateApiKeyCache(apiKey);
  } catch (err) {
    // ignore cache invalidation errors
  }
}

// Allow programmatic upsert/delete of the in-memory API_KEYS map.
export function upsertApiKey(apiKeyConfig: ApiKeyConfig): void {
  API_KEYS.set(apiKeyConfig.key, apiKeyConfig);
  // Also set cache so immediate requests will hit Redis
  setCachedApiKey(apiKeyConfig.key, JSON.stringify(apiKeyConfig), 300).catch(
    () => {},
  );
}

export function deleteApiKey(key: string): void {
  API_KEYS.delete(key);
  // Also invalidate cache
  invalidateApiKeyCache(key).catch(() => {});
}
