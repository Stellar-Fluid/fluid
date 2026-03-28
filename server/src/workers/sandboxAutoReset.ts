/**
 * Sandbox auto-reset worker
 *
 * Runs once per day and resets all sandbox API keys whose last reset
 * was more than 24 hours ago.
 */

import { createLogger } from "../utils/logger";
import { autoResetStaleSandboxKeys } from "../handlers/sandbox";

const logger = createLogger("sandboxAutoReset");

const INTERVAL_MS = Number(
  process.env.SANDBOX_AUTO_RESET_INTERVAL_MS ?? String(24 * 60 * 60 * 1000),
);

let timer: ReturnType<typeof setInterval> | null = null;

export function startSandboxAutoReset(): void {
  if (timer) return;

  logger.info({ intervalMs: INTERVAL_MS }, "Sandbox auto-reset worker started");

  // Run immediately on startup to catch any stale keys
  void runReset();

  timer = setInterval(() => {
    void runReset();
  }, INTERVAL_MS);

  // Don't keep the process alive just for this timer
  timer.unref();
}

export function stopSandboxAutoReset(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("Sandbox auto-reset worker stopped");
  }
}

async function runReset(): Promise<void> {
  try {
    const count = await autoResetStaleSandboxKeys();
    if (count > 0) {
      logger.info({ count }, "Auto-reset completed for stale sandbox keys");
    }
  } catch (err) {
    logger.error({ err }, "Sandbox auto-reset run failed");
  }
}
