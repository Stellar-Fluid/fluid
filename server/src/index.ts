import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { feeBumpHandler } from "./handlers/feeBump";
import { loadConfig } from "./config";
import { apiKeyMiddleware } from "./middleware/apiKeys";
import { apiKeyRateLimit } from "./middleware/rateLimit";

dotenv.config();

const app = express();
app.use(express.json());

const config = loadConfig();

// Configure rate limiter
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  message: { error: "Too many requests from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
// CORS configuration with origin validation
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      callback(null, false);
      return;
    }

    // Check if the origin is in the allowed list
    if (config.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Reject the request - pass error to trigger error handler
    callback(new Error("Origin not allowed by CORS"), false);
  },
  credentials: true,
};

app.use(cors(corsOptions));

// Error handler for CORS rejections
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err.message === "Origin not allowed by CORS") {
    res.status(403).json({ error: "CORS not allowed" });
    return;
  }
  next(err);
});

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/fee-bump", apiKeyMiddleware, apiKeyRateLimit, limiter, (req: Request, res: Response) => {
  feeBumpHandler(req, res, config);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Fluid server running on http://0.0.0.0:${PORT}`);
  console.log(`Fee payer: ${config.feePayerPublicKey}`);
});
