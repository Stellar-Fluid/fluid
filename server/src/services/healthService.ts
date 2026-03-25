import StellarSdk, { Horizon } from "@stellar/stellar-sdk";
import { Config } from "../config";

const BALANCE_CRITICAL_THRESHOLD = 1; // XLM
const BALANCE_WARNING_THRESHOLD = 5; // XLM
const HORIZON_TIMEOUT_MS = 5000;

type HealthStatus = "healthy" | "degraded" | "unhealthy";

interface FeePayerHealth {
  publicKey: string;
  status: "healthy" | "warning" | "critical" | "error" | "skipped";
  balance: number | null;
  warning?: string;
  error?: string;
  note?: string;
}

interface HealthResponse {
  status: HealthStatus;
  version: string;
  network: string;
  timestamp: string;
  checks: {
    api: "ok";
    horizon: {
      status: "healthy" | "unhealthy" | "not_configured";
      url: string;
      error?: string;
    };
    feePayers: FeePayerHealth[];
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operationName: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

export async function getHealthStatus(config: Config): Promise<HealthResponse> {
  const response: HealthResponse = {
    status: "healthy",
    version: process.env.npm_package_version || "0.1.0",
    network: config.networkPassphrase,
    timestamp: new Date().toISOString(),
    checks: {
      api: "ok",
      horizon: {
        status: "not_configured",
        url: config.horizonUrl || "not configured",
      },
      feePayers: [],
    },
  };

  // ✅ Create server deterministically (fixes null issue)
  const server = config.horizonUrl
    ? new StellarSdk.Server(config.horizonUrl)
    : null;

  // ✅ Horizon check
  if (server) {
    try {
      await withTimeout(
        server.serverInfo(),
        HORIZON_TIMEOUT_MS,
        "Horizon serverInfo",
      );

      response.checks.horizon.status = "healthy";
    } catch (error: unknown) {
      const err = error as Error;

      response.checks.horizon.status = "unhealthy";
      response.checks.horizon.error =
        err.message || "Failed to connect to Horizon";

      response.status = "unhealthy";
    }
  }

  // ✅ Fee payer checks
  for (const feePayer of config.feePayerAccounts) {
    const payerHealth: FeePayerHealth = {
      publicKey: feePayer.publicKey,
      status: "unknown" as FeePayerHealth["status"],
      balance: null,
    };

    if (server) {
      try {
        const account = await withTimeout<Horizon.AccountResponse>(
          server.loadAccount(feePayer.publicKey),
          HORIZON_TIMEOUT_MS,
          `loadAccount(${feePayer.publicKey.slice(0, 6)}...)`,
        );

        const xlmBalance = account.balances.find(
          (b: Horizon.HorizonApi.BalanceLine) => b.asset_type === "native",
        ) as Horizon.HorizonApi.BalanceLineNative | undefined;

        const balance = xlmBalance ? parseFloat(xlmBalance.balance) : 0;

        payerHealth.balance = balance;

        if (balance < BALANCE_CRITICAL_THRESHOLD) {
          payerHealth.status = "critical";
          payerHealth.warning = `Below ${BALANCE_CRITICAL_THRESHOLD} XLM`;
          response.status = "unhealthy";
        } else if (balance < BALANCE_WARNING_THRESHOLD) {
          payerHealth.status = "warning";
          payerHealth.warning = `Below ${BALANCE_WARNING_THRESHOLD} XLM`;

          if (response.status !== "unhealthy") {
            response.status = "degraded";
          }
        } else {
          payerHealth.status = "healthy";
        }
      } catch (error: unknown) {
        const err = error as Error;

        payerHealth.status = "error";
        payerHealth.error = err.message || "Failed to load account";

        response.status = "unhealthy";
      }
    } else {
      payerHealth.status = "skipped";
      payerHealth.note = "Horizon not available";
    }

    response.checks.feePayers.push(payerHealth);
  }

  return response;
}
