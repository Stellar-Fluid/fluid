import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createLogger, serializeError } from "./utils/logger";
import redisClient from "./utils/redis";
import { RedisRateLimitStore } from "./utils/redisRateLimitStore";
import cors from "cors";
import dotenv from "dotenv";
import { loadConfig } from "./config";
import { AppError } from "./errors/AppError";
import { feeBumpHandler } from "./handlers/feeBump";
import { apiKeyMiddleware } from "./middleware/apiKeys";
import {
  listApiKeysHandler,
  revokeApiKeyHandler,
  upsertApiKeyHandler,
} from "./handlers/adminApiKeys";
import { feeBumpHandler } from "./handlers/feeBump";
import { getHorizonFailoverClient } from "./horizon/failoverClient";
import { apiKeyMiddleware } from "./middleware/apiKeys";
import {
  addSignerHandler,
  listSignersHandler,
  removeSignerHandler,
} from "./handlers/adminSigners";
import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiKeyRateLimit } from "./middleware/rateLimit";
import { AlertService } from "./services/alertService";
import { hydratePersistedSigners, listAdminSigners } from "./services/signerRegistry";
import { initializeBalanceMonitor } from "./workers/balanceMonitor";
import {
  getLedgerMonitor,
  initializeLedgerMonitor,
} from "./workers/ledgerMonitor";
import { transactionStore } from "./workers/transactionStore";

const logger = createLogger({ component: "server" });
import { getHorizonFailoverClient } from "./horizon/failoverClient";

dotenv.config();

const logger = createLogger({ component: "server" });
const app = express();

// Stripe webhook needs raw body for signature verification
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// JSON parsing for all other routes
app.use(express.json());

const config = loadConfig();
const alertService = new AlertService(config.alerting);

const windowSeconds = Math.max(1, Math.ceil(config.rateLimitWindowMs / 1000));
let limiterStore: unknown;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RateLimitRedis = require("rate-limit-redis");
  const RedisStore = RateLimitRedis.default || RateLimitRedis;
  limiterStore = new RedisStore({ client: redisClient, expiry: windowSeconds });
} catch {
  try {
    limiterStore = new RedisRateLimitStore(redisClient, windowSeconds);
  } catch (error) {
    logger.error({ ...serializeError(error) }, "Failed to initialize rate-limit store");
  }
}

const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  message: {
    error: "Too many requests from this IP, please try again later.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: limiterStore as any,
});

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) {
      callback(null, false);
      return;
    }

    if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"), false);
  },
  credentials: true,
};

app.use(cors(corsOptions));

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err.message === "Origin not allowed by CORS") {
    return next(new AppError("CORS not allowed", 403, "AUTH_FAILED"));
  }
  next(err);
});

app.get("/health", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signers = await listAdminSigners(config);
    res.json({
      status: "ok",
      fee_payers: signers.map((account) => ({
        publicKey: account.publicKey,
        status: account.status,
        in_flight: account.inFlight,
        total_uses: account.totalUses,
        sequence_number: account.sequenceNumber,
        balance: account.balance,
        source: account.source,
      })),
      horizon_nodes:
        getHorizonFailoverClient()?.getNodeStatuses() ??
        getLedgerMonitor()?.getNodeStatuses() ??
        config.horizonUrls.map((url) => ({
          url,
          state: "Active",
          consecutiveFailures: 0,
        })),
      total: signers.length,
      low_balance_alerting: {
        enabled:
          config.alerting.lowBalanceThresholdXlm !== undefined &&
          alertService.isEnabled() &&
          Boolean(config.horizonUrl),
        threshold_xlm: config.alerting.lowBalanceThresholdXlm ?? null,
        check_interval_ms: config.alerting.checkIntervalMs,
        cooldown_ms: config.alerting.cooldownMs,
        slack_configured: Boolean(config.alerting.slackWebhookUrl),
        email_configured: Boolean(config.alerting.email),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/fee-bump",
  apiKeyMiddleware,
  apiKeyRateLimit,
  limiter,
  (req: Request, res: Response, next: NextFunction) => {
    void feeBumpHandler(req, res, config, next);
  },
);

app.post("/test/add-transaction", (req: Request, res: Response) => {
  const { hash, status = "pending", tenantId = "test-tenant" } = req.body;

  if (!hash) {
    res.status(400).json({ error: "Transaction hash is required" });
    return;
  }

  transactionStore.addTransaction(hash, tenantId, status);
  res.json({ message: `Transaction ${hash} added with status ${status}` });
});

app.get("/test/transactions", (req: Request, res: Response) => {
  res.json({ transactions: transactionStore.getAllTransactions() });
});

app.post("/test/alerts/low-balance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!alertService.isEnabled()) {
      res.status(400).json({
        error: "No alert transport configured. Set Slack webhook or SMTP env vars first.",
      });
      return;
    }

    await alertService.sendTestAlert(config);
    res.json({ message: "Test low-balance alert sent" });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/api-keys", listApiKeysHandler);
app.post("/admin/api-keys", upsertApiKeyHandler);
app.patch("/admin/api-keys/:key/revoke", revokeApiKeyHandler);
app.delete("/admin/api-keys/:key", revokeApiKeyHandler);
app.get("/admin/signers", listSignersHandler(config));
app.post("/admin/signers", addSignerHandler(config));
app.delete("/admin/signers/:publicKey", removeSignerHandler(config));

// 404 - must come after all routes
app.use(notFoundHandler);
app.use(globalErrorHandler);

const PORT = process.env.PORT || 3000;

async function bootstrap(): Promise<void> {
  try {
    await hydratePersistedSigners(config);
  } catch (error) {
    logger.error({ ...serializeError(error) }, "Failed to hydrate persisted signers");
  }

  if (config.horizonUrls.length > 0) {
    try {
      const ledgerMonitor = initializeLedgerMonitor(config);
      ledgerMonitor.start();
      logger.info("Ledger monitor worker started");
    } catch (error) {
      logger.error({ ...serializeError(error) }, "Failed to start ledger monitor");
    }
  } else {
    logger.info("No Horizon URLs configured; ledger monitor disabled");
  }

  if (
    config.horizonUrl &&
    config.alerting.lowBalanceThresholdXlm !== undefined &&
    alertService.isEnabled()
  ) {
    try {
      const balanceMonitor = initializeBalanceMonitor(config, alertService);
      balanceMonitor.start();
      logger.info("Balance monitor worker started");
    } catch (error) {
      logger.error({ ...serializeError(error) }, "Failed to start balance monitor");
    }
  } else {
    logger.info(
      "Low balance alerting disabled - missing Horizon URL, threshold, or alert transport",
    );
  }

  app.listen(PORT, () => {
    logger.info(
      {
        fee_payers_loaded: config.feePayerAccounts.length,
        fee_payer_public_keys: config.feePayerAccounts.map((account) => account.publicKey),
        horizon_node_count: config.horizonUrls.length,
        horizon_nodes: config.horizonUrls,
        horizon_selection_strategy: config.horizonSelectionStrategy,
        port: PORT,
        url: `http://0.0.0.0:${PORT}`,
      },
      "Fluid server started",
    );
  });
}

let balanceMonitor: any = null;
if (
  config.horizonUrl &&
  config.alerting.lowBalanceThresholdXlm !== undefined &&
  alertService.isEnabled()
) {
  try {
    balanceMonitor = initializeBalanceMonitor(config, alertService);
    balanceMonitor.start();
    console.log("Balance monitor worker started");
  } catch (error) {
    console.error("Failed to start balance monitor:", error);
  }
} else {
  console.log(
    "Low balance alerting disabled - missing Horizon URL, threshold, or alert transport",
  );
}

app.listen(PORT, () => {
  logger.info(
    {
      fee_payers_loaded: config.feePayerAccounts.length,
      fee_payer_public_keys: config.feePayerAccounts.map(
        (account) => account.publicKey,
      ),
      horizon_node_count: config.horizonUrls.length,
      horizon_nodes: config.horizonUrls,
      horizon_selection_strategy: config.horizonSelectionStrategy,
      port: PORT,
      url: `http://0.0.0.0:${PORT}`,
    },
    "Fluid server started",
  );
});
void bootstrap();
