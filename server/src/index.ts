import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";

import { loadConfig } from "./config";
import { AppError } from "./errors/AppError";
import { feeBumpHandler } from "./handlers/feeBump";
import {
  getHorizonFailoverClient,
  initializeHorizonFailoverClient,
} from "./horizon/failoverClient";
import { apiKeyMiddleware } from "./middleware/apiKeys";
import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiKeyRateLimit } from "./middleware/rateLimit";
import { transactionStore } from "./workers/transactionStore";
import {
  getLedgerMonitor,
  initializeLedgerMonitor,
} from "./workers/ledgerMonitor";

import { initializeLedgerMonitor } from "./workers/ledgerMonitor";
import { transactionStore } from "./workers/transactionStore";

dotenv.config();

const app = express();
app.use(express.json());

const config = loadConfig();
if (config.horizonUrls.length > 0) {
  initializeHorizonFailoverClient(config);
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
  });
});

// Fee bump endpoint
app.post(
  "/fee-bump",
  apiKeyMiddleware,
  apiKeyRateLimit,
  limiter,
  (req: Request, res: Response, next: NextFunction) => {
    feeBumpHandler(req, res, config, next);
  }
);

app.post("/test/add-transaction", (req: Request, res: Response) => {
  const { hash, status = "pending" } = req.body;

  if (!hash) {
    res.status(400).json({ error: "Transaction hash is required" });
    return;
  }

  transactionStore.addTransaction(hash, status);
  res.json({ message: `Transaction ${hash} added with status ${status}` });
});

app.get("/test/transactions", (req: Request, res: Response) => {
  const transactions = transactionStore.getAllTransactions();
  res.json({ transactions });
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

const PORT = process.env.PORT || 3000;

let ledgerMonitor: ReturnType<typeof initializeLedgerMonitor> | null = null;
if (config.horizonUrls.length > 0) {
  try {
    ledgerMonitor = initializeLedgerMonitor(config);
    ledgerMonitor.start();
    console.log("Ledger monitor worker started");
  } catch (error) {
    console.error("Failed to start ledger monitor:", error);
  }
} else {
  console.log("No Horizon URLs configured - ledger monitor disabled");
}

// ✅ Start server
app.listen(PORT, () => {
  console.log(`Fluid server running on http://0.0.0.0:${PORT}`);
  console.log(`Fee payers loaded: ${config.feePayerAccounts.length}`);
  config.feePayerAccounts.forEach((account, index) => {
    console.log(`  [${index + 1}] ${account.publicKey}`);
  });
  console.log(
    `Horizon strategy: ${config.horizonSelectionStrategy} | nodes: ${config.horizonUrls.length}`
  );
  config.horizonUrls.forEach((url, index) => {
    console.log(`  [${index + 1}] ${url}`);
  });
});
