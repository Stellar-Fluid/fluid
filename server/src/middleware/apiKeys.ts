import { NextFunction, Request, Response } from "express";

export interface ApiKeyConfig {
  key: string;
  name: string;
  tier: "free" | "pro";
  maxRequests: number;
  windowMs: number;
}

const API_KEYS = new Map<string, ApiKeyConfig>([
  [
    "fluid-free-demo-key",
    {
      key: "fluid-free-demo-key",
      name: "Demo Free dApp",
      tier: "free",
      maxRequests: 2,
      windowMs: 60_000,
    },
  ],
  [
    "fluid-pro-demo-key",
    {
      key: "fluid-pro-demo-key",
      name: "Demo Pro dApp",
      tier: "pro",
      maxRequests: 5,
      windowMs: 60_000,
    },
  ],
]);

function getApiKeyFromHeader(req: Request): string | undefined {
  const headerValue = req.header("x-api-key");

  if (typeof headerValue !== "string") {
    return undefined;
  }

  const apiKey = headerValue.trim();
  return apiKey.length > 0 ? apiKey : undefined;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`;
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = getApiKeyFromHeader(req);

  if (!apiKey) {
    res.status(401).json({
      error:
        "Missing API key. Provide a valid x-api-key header to access this endpoint.",
    });
    return;
  }

  const apiKeyConfig = API_KEYS.get(apiKey);

  if (!apiKeyConfig) {
    res.status(403).json({
      error: "Invalid API key.",
    });
    return;
  }

  res.locals.apiKey = apiKeyConfig;
  next();
}

export function getApiKeyConfig(apiKey: string): ApiKeyConfig | undefined {
  return API_KEYS.get(apiKey);
}
