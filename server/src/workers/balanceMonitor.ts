import * as StellarSdk from "@stellar/stellar-sdk";
import { Config } from "../config";
import {
  AlertService,
  resolveLowBalanceCheckIntervalMs,
  resolveLowBalanceThresholdXlm,
} from "../services/alertService";

export class BalanceMonitor {
  private readonly server: StellarSdk.Horizon.Server;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly alertService: AlertService,
  ) {
    if (!config.horizonUrl) {
      throw new Error("Horizon URL is required for balance monitoring");
    }

    this.server = new StellarSdk.Horizon.Server(config.horizonUrl);
  }

  start(): void {
    const threshold = resolveLowBalanceThresholdXlm(
      this.config.alerting.lowBalanceThresholdXlm,
    );
    const checkIntervalMs = resolveLowBalanceCheckIntervalMs(
      this.config.alerting.checkIntervalMs,
    );
    console.log("[BalanceMonitor] Starting balance monitor worker");
    console.log(`[BalanceMonitor] Poll interval: ${checkIntervalMs}ms`);
    console.log(`[BalanceMonitor] Threshold: ${threshold} XLM`);

    void this.checkBalances();
    this.intervalHandle = setInterval(() => {
      void this.checkBalances();
    }, checkIntervalMs);
  }

  stop(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    console.log("[BalanceMonitor] Stopped balance monitor worker");
  }

  async checkBalances(): Promise<void> {
    const threshold = resolveLowBalanceThresholdXlm(
      this.config.alerting.lowBalanceThresholdXlm,
    );
    if (threshold === undefined) {
      return;
    }

    try {
      for (const account of this.config.feePayerAccounts) {
        const balanceXlm = await this.getNativeBalance(account.publicKey);
        console.log(
          `[BalanceMonitor] ${account.publicKey} balance: ${balanceXlm.toFixed(7)} XLM`,
        );

        if (balanceXlm < threshold) {
          const wasSent = await this.alertService.sendLowBalanceAlert({
            accountPublicKey: account.publicKey,
            balanceXlm,
            thresholdXlm: threshold,
            networkPassphrase: this.config.networkPassphrase,
            horizonUrl: this.config.horizonUrl,
            checkedAt: new Date(),
          });

          if (wasSent) {
            console.warn(
              `[BalanceMonitor] Low balance alert sent for ${account.publicKey}`,
            );
          }
        } else {
          this.alertService.markBalanceRecovered(account.publicKey);
        }
      }
    } catch (error) {
      console.error("[BalanceMonitor] Failed to check fee payer balances:", error);
    }
  }

  private async getNativeBalance(publicKey: string): Promise<number> {
    const account = await this.server.loadAccount(publicKey);
    const nativeBalance = account.balances.find(
      (balance) => balance.asset_type === "native",
    );

    return nativeBalance ? Number.parseFloat(nativeBalance.balance) : 0;
  }
}

let balanceMonitor: BalanceMonitor | null = null;

export function initializeBalanceMonitor(
  config: Config,
  alertService: AlertService,
): BalanceMonitor {
  if (balanceMonitor) {
    balanceMonitor.stop();
  }

  balanceMonitor = new BalanceMonitor(config, alertService);
  return balanceMonitor;
}

export function getBalanceMonitor(): BalanceMonitor | null {
  return balanceMonitor;
}
