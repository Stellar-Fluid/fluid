import dotenv from "dotenv";
import path from "path";
import type { AlertingConfig, Config } from "./config";
import { SignerPool } from "./signing";
import {
  AlertService,
  resolveLowBalanceCheckIntervalMs,
  resolveLowBalanceCooldownMs,
  resolveLowBalanceThresholdXlm,
} from "./services/alertService";
import {
  SlackNotifier,
  loadSlackNotifierOptionsFromEnv,
} from "./services/slackNotifier";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main(): Promise<void> {
  const config = buildTestConfig();
  const slackNotifier = new SlackNotifier(loadSlackNotifierOptionsFromEnv());
  const alertService = new AlertService(config.alerting, slackNotifier);

  console.log("---------------------------------------------------");
  console.log("  Fluid - Fee-Payer Low Balance Alert Test         ");
  console.log("---------------------------------------------------");
  console.log(
    `  Slack configured : ${slackNotifier.isConfigured() ? "yes" : "no"}`,
  );
  console.log(`  Email configured : ${config.alerting.email ? "yes" : "no"}`);
  console.log(
    `  Threshold        : ${config.alerting.lowBalanceThresholdXlm ?? "not set"} XLM`,
  );
  console.log(`  Horizon URL      : ${config.horizonUrl ?? "not set"}`);
  console.log("---------------------------------------------------");

  if (!alertService.isEnabled()) {
    throw new Error(
      "No alert transport configured. Set Slack, SMTP, or Resend env vars in server/.env.",
    );
  }

  await alertService.sendTestAlert(config);
  console.log("Test alert sent successfully. Check Slack or your inbox now.");
}

function buildTestConfig(): Config {
  const lowBalanceThresholdXlm = resolveLowBalanceThresholdXlm(
    parseOptionalNumber(process.env.FLUID_LOW_BALANCE_THRESHOLD_XLM),
  );

  const emailHost = process.env.FLUID_ALERT_SMTP_HOST?.trim();
  const emailFrom =
    process.env.RESEND_EMAIL_FROM?.trim() ||
    process.env.FLUID_ALERT_EMAIL_FROM?.trim();
  const emailTo = (process.env.RESEND_EMAIL_TO || process.env.FLUID_ALERT_EMAIL_TO)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const alerting: AlertingConfig = {
    lowBalanceThresholdXlm,
    checkIntervalMs: resolveLowBalanceCheckIntervalMs(undefined),
    cooldownMs: resolveLowBalanceCooldownMs(undefined),
    slackWebhookUrl:
      process.env.SLACK_WEBHOOK_URL?.trim() ||
      process.env.FLUID_ALERT_SLACK_WEBHOOK_URL?.trim() ||
      undefined,
    email:
      emailHost && emailFrom && emailTo && emailTo.length > 0
        ? {
            host: emailHost,
            port: parsePositiveInt(process.env.FLUID_ALERT_SMTP_PORT, 587),
            secure: process.env.FLUID_ALERT_SMTP_SECURE === "true",
            user: process.env.FLUID_ALERT_SMTP_USER?.trim() || undefined,
            pass: process.env.FLUID_ALERT_SMTP_PASS?.trim() || undefined,
            from: emailFrom,
            to: emailTo,
          }
        : undefined,
  };

  return {
    feePayerAccounts: [],
    signerPool: new SignerPool([
      {
        keypair: require("@stellar/stellar-sdk").Keypair.random(),
        secret: "test-secret",
      },
    ]),
    baseFee: 100,
    feeMultiplier: 2,
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      "Test SDF Network ; September 2015",
    horizonUrl: process.env.STELLAR_HORIZON_URL,
    horizonUrls: process.env.STELLAR_HORIZON_URL
      ? [process.env.STELLAR_HORIZON_URL]
      : [],
    horizonSelectionStrategy: "priority",
    rateLimitWindowMs: parsePositiveInt(
      process.env.FLUID_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    rateLimitMax: parsePositiveInt(process.env.FLUID_RATE_LIMIT_MAX, 5),
    allowedOrigins: [],
    maxXdrSize: 10_240,
    maxOperations: 100,
    alerting,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

main().catch((error) => {
  console.error("Failed to send test alert:", error);
  process.exit(1);
});
