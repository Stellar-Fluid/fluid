import { Config } from "../config";
import { HorizonFailoverClient } from "../horizon/failoverClient";
import { TransactionRecord, transactionStore } from "./transactionStore";

export class LedgerMonitor {
  private readonly client: HorizonFailoverClient;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 30000;

  constructor(config: Config) {
    if (config.horizonUrls.length === 0) {
      throw new Error("At least one Horizon URL is required for ledger monitoring");
    }

    this.client = HorizonFailoverClient.fromConfig(config);
  }

  start(): void {
    console.log("[LedgerMonitor] Starting ledger monitor worker");
    console.log(`[LedgerMonitor] Poll interval: ${this.POLL_INTERVAL_MS}ms`);
    this.checkPendingTransactions();

    this.pollInterval = setInterval(() => {
      this.checkPendingTransactions();
    }, this.POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log("[LedgerMonitor] Stopped ledger monitor worker");
    }
  }

  getNodeStatuses() {
    return this.client.getNodeStatuses();
  }

  private async checkPendingTransactions(): Promise<void> {
    try {
      console.log("[LedgerMonitor] Checking pending transactions...");

      const pendingTransactions = transactionStore.getPendingTransactions();
      if (pendingTransactions.length === 0) {
        console.log("[LedgerMonitor] No pending transactions to check");
        return;
      }

      console.log(
        `[LedgerMonitor] Processing ${pendingTransactions.length} pending transactions`
      );

      const batchSize = 5;
      for (let i = 0; i < pendingTransactions.length; i += batchSize) {
        const batch = pendingTransactions.slice(i, i + batchSize);
        await Promise.all(batch.map((tx) => this.checkTransaction(tx)));

        if (i + batchSize < pendingTransactions.length) {
          await this.delay(1000);
        }
      }
    } catch (error) {
      console.error("[LedgerMonitor] Error checking pending transactions:", error);
    }
  }

  private async checkTransaction(transaction: TransactionRecord): Promise<void> {
    try {
      console.log(
        `[LedgerMonitor] Checking transaction ${transaction.hash} (current status: ${transaction.status})`
      );

      const txRecord = await this.client.getTransaction(transaction.hash);

      if (txRecord.successful) {
        console.log(`[LedgerMonitor] Transaction ${transaction.hash} was SUCCESSFUL`);
        transactionStore.updateTransactionStatus(transaction.hash, "success");
        await this.webhookService.dispatch(transaction.tenantId, transaction.hash, "success");
      } else {
        console.log(
          `[LedgerMonitor] Transaction ${transaction.hash} was UNSUCCESSFUL`
        );
        transactionStore.updateTransactionStatus(transaction.hash, "failed");
        await this.webhookService.dispatch(transaction.tenantId, transaction.hash, "failed");
      }
    } catch (error: any) {
      if (error.response?.status === 404 || error.message?.includes("404")) {
        console.log(
          `[LedgerMonitor] Transaction ${transaction.hash} not found on ledger (404) - marking as failed`
        );
        transactionStore.updateTransactionStatus(transaction.hash, "failed");
        await this.webhookService.dispatch(transaction.tenantId, transaction.hash, "failed");
      } else {
        console.error(
          `[LedgerMonitor] Error checking transaction ${transaction.hash}:`,
          error.message || error
        );
        if (transaction.hash.startsWith("test-") || transaction.hash.length < 56) {
          console.log(
            `[LedgerMonitor] Test/invalid transaction ${transaction.hash} - marking as failed`
          );
          transactionStore.updateTransactionStatus(transaction.hash, "failed");
          await this.webhookService.dispatch(transaction.tenantId, transaction.hash, "failed");
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let ledgerMonitor: LedgerMonitor | null = null;

export function initializeLedgerMonitor(config: Config): LedgerMonitor {
  if (ledgerMonitor) {
    console.log(
      "[LedgerMonitor] Ledger monitor already initialized, stopping previous instance"
    );
    ledgerMonitor.stop();
  }

  ledgerMonitor = new LedgerMonitor(config, new WebhookService());
  return ledgerMonitor;
}

export function getLedgerMonitor(): LedgerMonitor | null {
  return ledgerMonitor;
}
