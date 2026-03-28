import "dotenv/config";

import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";
import rateLimit from "express-rate-limit";
import { loadConfig } from "./config";
import { AppError } from "./errors/AppError";
import {
  listApiKeysHandler,
  revokeApiKeyHandler,
  upsertApiKeyHandler,
} from "./handlers/adminApiKeys";
import {
  listSubscriptionTiersHandler,
  updateTenantSubscriptionTierHandler,
} from "./handlers/adminSubscriptionTiers";
import {
  addSignerHandler,
  listSignersHandler,
  removeSignerHandler,
} from "./handlers/adminSigners";
import { badgeHandler } from "./handlers/badge";
import { feeBumpBatchHandler, feeBumpHandler } from "./handlers/feeBump";
import { createCheckoutSessionHandler, stripeWebhookHandler } from "./handlers/stripe";
import {
  getHorizonFailoverClient,
  initializeHorizonFailoverClient,
} from "./horizon/failoverClient";
import { apiKeyMiddleware } from "./middleware/apiKeys";
import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiKeyRateLimit } from "./middleware/rateLimit";
import { tenantTierTxLimit } from "./middleware/txLimit";
import { AlertService } from "./services/alertService";
import { hydratePersistedSigners, listAdminSigners } from "./services/signerRegistry";
import { createLogger, serializeError } from "./utils/logger";
import redisClient from "./utils/redis";
import { RedisRateLimitStore } from "./utils/redisRateLimitStore";
import { initializeBalanceMonitor } from "./workers/balanceMonitor";
import {
  getLedgerMonitor,
  initializeLedgerMonitor,
} from "./workers/ledgerMonitor";
import { initializeIncidentMonitor } from "./workers/incidentMonitor";
import { transactionStore } from "./workers/transactionStore";
import { healthHandler } from "./handlers/health";

dotenv.config();

const app = express();
app.use(express.json());

// Swagger UI — available at /docs
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// Raw OpenAPI JSON spec
app.get("/docs.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

const config = loadConfig();
const slackNotifier = new SlackNotifier(loadSlackNotifierOptionsFromEnv());
const pagerDutyNotifier = new PagerDutyNotifier();
const fcmNotifier = initializeFcmNotifier();
if (fcmNotifier.isConfigured()) {
  logger.info("FCM push notifications enabled");
} else {
  logger.info("FCM push notifications disabled - FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY not set");
}
const alertService = new AlertService(config.alerting, slackNotifier, { fcmNotifier });

// Use Redis-backed store for global IP rate limiting. Falls back to memory store if Redis unavailable.
const windowSeconds = Math.max(1, Math.ceil(config.rateLimitWindowMs / 1000));
let limiterStore: any = undefined;
try {
  // Prefer a maintained adapter if available: rate-limit-redis
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RateLimitRedis = require("rate-limit-redis");
  const RedisStore = RateLimitRedis.default || RateLimitRedis;
  // Many adapters accept `client` for an ioredis instance and `expiry` or `windowMs`.
  limiterStore = new RedisStore({ client: redisClient, expiry: windowSeconds });
} catch (err) {
  // Fallback to the lightweight custom store we added earlier
  try {
    limiterStore = new RedisRateLimitStore(redisClient, windowSeconds);
  } catch (innerErr) {
    console.error("Failed to initialize Redis rate-limit store:", innerErr);
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
  store: limiterStore,
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

    if (
      config.allowedOrigins.length === 0 ||
      config.allowedOrigins.includes(origin)
    ) {
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

app.get("/badge", (req: Request, res: Response) => {
  void badgeHandler(req, res, config);
});

app.get("/health", (req: Request, res: Response) => {
  const accounts = config.signerPool.getSnapshot().map((account) => ({
    publicKey: account.publicKey,
    status: account.active ? "active" : "inactive",
    in_flight: account.inFlight,
    total_uses: account.totalUses,
    sequence_number: account.sequenceNumber,
    balance: account.balance,
  }));

  res.json({
    status: "ok",
    fee_payers: accounts,
    horizon_nodes:
      getHorizonFailoverClient()?.getNodeStatuses() ??
      getLedgerMonitor()?.getNodeStatuses() ??
      config.horizonUrls.map((url) => ({
        url,
        state: "Active",
        consecutiveFailures: 0,
      })),
    total: accounts.length,
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
});

// Fee bump endpoint
app.post(
  "/fee-bump",
  apiKeyMiddleware,
  apiKeyRateLimit,
  tenantTierTxLimit,
  limiter,
  (req: Request, res: Response, next: NextFunction) => {
    void feeBumpHandler(req, res, config, next);
  },
);

app.post(
  "/fee-bump/batch",
  apiKeyMiddleware,
  apiKeyRateLimit,
  tenantTierTxLimit,
  limiter,
  (req: Request, res: Response, next: NextFunction) => {
    feeBumpBatchHandler(req, res, next, config);
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
  const transactions = transactionStore.getAllTransactions();
  res.json({ transactions });
});

app.post(
  "/test/alerts/low-balance",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!alertService.isEnabled()) {
        return res.status(400).json({
          error:
            "No alert transport configured. Set Slack webhook or SMTP env vars first.",
        });
      }

      await alertService.sendTestAlert(config);
      res.json({ message: "Test low-balance alert sent" });
    } catch (error) {
      next(error);
    }
  },
);

app.get("/admin/api-keys", listApiKeysHandler);
app.post("/admin/api-keys", upsertApiKeyHandler);
app.patch("/admin/api-keys/:key/revoke", revokeApiKeyHandler);
app.delete("/admin/api-keys/:key", revokeApiKeyHandler);
app.get("/admin/subscription-tiers", listSubscriptionTiersHandler);
app.patch("/admin/tenants/:tenantId/subscription-tier", updateTenantSubscriptionTierHandler);
app.get("/admin/signers", listSignersHandler(config));
app.post("/admin/signers", addSignerHandler(config));
app.delete("/admin/signers/:publicKey", removeSignerHandler(config));
app.get("/admin/device-tokens", listDeviceTokensHandler);
app.post("/admin/device-tokens", registerDeviceTokenHandler);
app.delete("/admin/device-tokens/:id", deleteDeviceTokenHandler);

app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);
app.post("/create-checkout-session", createCheckoutSessionHandler);

app.use(notFoundHandler);
app.use(createGlobalErrorHandler(slackNotifier));

const PORT = process.env.PORT || 3000;

let ledgerMonitor: ReturnType<typeof initializeLedgerMonitor> | null = null;
let balanceMonitor: ReturnType<typeof initializeBalanceMonitor> | null = null;
let incidentMonitor: ReturnType<typeof initializeIncidentMonitor> | null = null;
let shuttingDown = false;
let server: ReturnType<typeof app.listen> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await slackNotifier.notifyServerLifecycle({
    detail: `Signal received: ${signal}`,
    phase: "stop",
    timestamp: new Date(),
  });

  ledgerMonitor?.stop();
  balanceMonitor?.stop();
  incidentMonitor?.stop();

  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
    return;
  }

  process.exit(0);
}

// --- Background Workers ---
let ledgerMonitorInstance: any = null;
if (config.horizonUrls.length > 0) {
  try {
    ledgerMonitorInstance = initializeLedgerMonitor(config);
    ledgerMonitorInstance.start();
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
    balanceMonitor = initializeBalanceMonitor(config, alertService);
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

if (pagerDutyNotifier.isConfigured() || fcmNotifier.isConfigured()) {
  try {
    incidentMonitor = initializeIncidentMonitor(config, pagerDutyNotifier, {}, fcmNotifier);
    incidentMonitor.start();
    logger.info("Incident monitor worker started");
  } catch (error) {
    logger.error({ ...serializeError(error) }, "Failed to start incident monitor");
  }
} else {
  logger.info("PagerDuty incident alerting disabled - routing key not set");
}

server = app.listen(PORT, () => {
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
