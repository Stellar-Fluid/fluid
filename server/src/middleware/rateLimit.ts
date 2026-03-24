import { NextFunction, Request, Response } from "express";
import { ApiKeyConfig, maskApiKey } from "./apiKeys";

interface UsageEntry {
  count: number;
  resetTime: number;
}

const usageByApiKey = new Map<string, UsageEntry>();

function getUsageEntry(apiKeyConfig: ApiKeyConfig): UsageEntry {
  const now = Date.now();
  const existingEntry = usageByApiKey.get(apiKeyConfig.key);

  if (!existingEntry || now >= existingEntry.resetTime) {
    const freshEntry: UsageEntry = {
      count: 0,
      resetTime: now + apiKeyConfig.windowMs,
    };

    usageByApiKey.set(apiKeyConfig.key, freshEntry);
    return freshEntry;
  }

  return existingEntry;
}

export function apiKeyRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;

  if (!apiKeyConfig) {
    res.status(500).json({
      error: "API key context missing before rate limiting.",
    });
    return;
  }

  const usageEntry = getUsageEntry(apiKeyConfig);
  const now = Date.now();

  res.setHeader("X-RateLimit-Limit", apiKeyConfig.maxRequests.toString());
  res.setHeader(
    "X-RateLimit-Remaining",
    Math.max(apiKeyConfig.maxRequests - usageEntry.count - 1, 0).toString()
  );
  res.setHeader(
    "X-RateLimit-Reset",
    Math.ceil(usageEntry.resetTime / 1000).toString()
  );

  if (usageEntry.count >= apiKeyConfig.maxRequests) {
    res.status(429).json({
      error: `API key rate limit exceeded for ${maskApiKey(apiKeyConfig.key)} (${apiKeyConfig.tier} tier).`,
      tier: apiKeyConfig.tier,
      limit: apiKeyConfig.maxRequests,
      retryAfterSeconds: Math.max(
        Math.ceil((usageEntry.resetTime - now) / 1000),
        0
      ),
    });
    return;
  }

  usageEntry.count += 1;
  next();
}
