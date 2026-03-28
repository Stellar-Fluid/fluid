import StellarSdk from "@stellar/stellar-sdk";
import { SorobanRpc, Transaction } from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import {
  BuildSACTransferTxOptions,
  buildSACTransferTx as buildSACTransferTxHelper,
} from "./soroban";
import {
  createHorizonServer,
  fromTransactionXdr,
  resolveStellarSdk,
  toTransactionXdr,
} from "./stellarCompatibility";
import {
  collectTelemetry,
  getTelemetryConfig,
  TelemetryConfig,
} from "./telemetry";

dotenv.config();

export interface FluidClientConfig {
  serverUrl?: string;
  serverUrls?: string[];
  networkPassphrase: string;
  horizonUrl?: string;
  sorobanRpcUrl?: string;
  useWorker?: boolean; // New option to enable Web Worker for signing operations
  stellarSdk?: unknown;
  /**
   * Enable anonymous usage telemetry.
   * Default: false (opt-in)
   * 
   * When enabled, the SDK will send a single daily ping with:
   * - sdk_version: The installed package version
   * - domain: window.location.hostname (no path, no query params)
   * - timestamp: UTC date (day-level precision only)
   * 
   * No personal data, transaction data, or wallet addresses are collected.
   * Telemetry is fire-and-forget and never blocks SDK functionality.
   */
  enableTelemetry?: boolean;
  /**
   * Custom telemetry endpoint URL.
   * Default: 'https://telemetry.fluid.dev/ping'
   */
  telemetryEndpoint?: string;
}

export interface FeeBumpResponse {
  xdr: string;
  status: string;
  hash?: string;
}

// Worker message types
interface WorkerRequest {
  id: string;
  type: "sign_transaction" | "create_xdr";
  data: any;
}

interface WorkerResponse {
  id: string;
  type: "success" | "error";
  result?: any;
  error?: string;
}
export type WaitForConfirmationProgress = {
  hash: string;
  attempt: number;
  elapsedMs: number;
};

export type WaitForConfirmationOptions = {
  pollIntervalMs?: number;
  onProgress?: (progress: WaitForConfirmationProgress) => void;
};

type RequestError = Error & {
  status?: number;
  serverUrl?: string;
};

export class FluidClient {
  private serverUrls: string[];
  private networkPassphrase: string;
  private horizonServer?: any;
  private sorobanServer?: SorobanRpc.Server;
  private useWorker: boolean;
  private worker?: Worker;
  private pendingRequests: Map<
    string,
    { resolve: Function; reject: Function; timeout: ReturnType<typeof setTimeout> }
  > = new Map();
  private requestIdCounter: number = 0;
  private horizonUrl?: string;
  private stellarSdk: unknown;
  private readonly failedNodeCooldownMs = 30_000;
  private readonly baseRetryDelayMs = 250;
  private readonly maxRetryDelayMs = 2_000;
  private readonly nodeFailureState = new Map<
    string,
    { failures: number; failedUntil: number }
  >();

  constructor(config: FluidClientConfig) {
    this.serverUrls = this.normalizeServerUrls(config);
    this.networkPassphrase = config.networkPassphrase;
    this.useWorker = config.useWorker || false;

    this.stellarSdk = resolveStellarSdk(config.stellarSdk ?? StellarSdk);
    if (config.horizonUrl) {
      this.horizonServer = createHorizonServer(this.stellarSdk, config.horizonUrl);
    }

    // Initialize worker if enabled
    if (this.useWorker && typeof Worker !== "undefined") {
      this.initializeWorker();
    }
    if (config.sorobanRpcUrl) {
      this.sorobanServer = new SorobanRpc.Server(config.sorobanRpcUrl);
    }

    // Initialize telemetry if enabled
    const telemetryConfig = getTelemetryConfig({
      enabled: config.enableTelemetry,
      endpoint: config.telemetryEndpoint,
    });
    collectTelemetry(telemetryConfig);
  }

  private normalizeServerUrls(config: FluidClientConfig): string[] {
    const rawUrls = config.serverUrls?.length
      ? config.serverUrls
      : config.serverUrl
        ? [config.serverUrl]
        : [];

    const normalized = rawUrls
      .map((url) => url.trim().replace(/\/+$/, ""))
      .filter(Boolean);

    if (normalized.length === 0) {
      throw new Error(
        "FluidClient requires at least one server URL via serverUrl or serverUrls",
      );
    }

    return [...new Set(normalized)];
  }

  private getOrderedServerUrls(): string[] {
    const now = Date.now();

    return [...this.serverUrls]
      .map((url, index) => {
        const state = this.nodeFailureState.get(url);
        const isCoolingDown = state ? state.failedUntil > now : false;

        return {
          url,
          index,
          score: isCoolingDown ? 1_000 + state!.failedUntil - now : 0,
        };
      })
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .map((entry) => entry.url);
  }

  private markServerFailure(serverUrl: string): void {
    const previous = this.nodeFailureState.get(serverUrl);
    const failures = (previous?.failures ?? 0) + 1;
    const cooldownMultiplier = Math.min(2 ** (failures - 1), 4);

    this.nodeFailureState.set(serverUrl, {
      failures,
      failedUntil: Date.now() + this.failedNodeCooldownMs * cooldownMultiplier,
    });
  }

  private markServerSuccess(serverUrl: string): void {
    this.nodeFailureState.delete(serverUrl);
  }

  private getRetryDelayMs(attemptIndex: number): number {
    return Math.min(
      this.baseRetryDelayMs * 2 ** attemptIndex,
      this.maxRetryDelayMs,
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatServerErrorMessage(
    response: Response,
    errorText: string,
  ): string {
    try {
      const parsed = JSON.parse(errorText) as Record<string, unknown>;
      return `Fluid server error: ${JSON.stringify(parsed)}`;
    } catch {
      return `Fluid server error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`;
    }
  }

  private async performJsonRequest<T>(
    serverUrl: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${serverUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const requestError = new Error(
        `Fluid server request failed: ${error instanceof Error ? error.message : String(error)}`,
      ) as RequestError;
      requestError.serverUrl = serverUrl;
      throw requestError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const requestError = new Error(
        this.formatServerErrorMessage(response, errorText),
      ) as RequestError;
      requestError.status = response.status;
      requestError.serverUrl = serverUrl;
      throw requestError;
    }

    return (await response.json()) as T;
  }

  private async requestWithFallback<T>(
    path: string,
    body: unknown,
  ): Promise<T> {
    const orderedServerUrls = this.getOrderedServerUrls();
    let lastError: RequestError | undefined;

    for (let attemptIndex = 0; attemptIndex < orderedServerUrls.length; attemptIndex += 1) {
      const serverUrl = orderedServerUrls[attemptIndex];

      try {
        const result = await this.performJsonRequest<T>(serverUrl, path, body);
        this.markServerSuccess(serverUrl);
        return result;
      } catch (error) {
        const requestError =
          error instanceof Error ? (error as RequestError) : new Error(String(error));

        if ((requestError as RequestError).status === 400) {
          throw requestError;
        }

        lastError = requestError;
        this.markServerFailure(serverUrl);

        if (attemptIndex < orderedServerUrls.length - 1) {
          const retryDelayMs = this.getRetryDelayMs(attemptIndex);
          const nextServerUrl = orderedServerUrls[attemptIndex + 1];
          console.warn(
            `[FluidClient] Request failed on ${serverUrl} (${requestError.message}). Retrying ${path} on ${nextServerUrl} in ${retryDelayMs}ms.`,
          );
          await this.sleep(retryDelayMs);
        }
      }
    }

    throw (
      lastError ??
      new Error(`Fluid server error: no available servers for request to ${path}`)
    );
  }

  private initializeWorker(): void {
    try {
      // Create worker from the worker file
      this.worker = new Worker(
        new URL("./workers/signingWorker.ts", import.meta.url),
        {
          type: "module",
        },
      );

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, type, result, error } = event.data;
        const pending = this.pendingRequests.get(id);

        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(id);

          if (type === "success") {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error || "Worker operation failed"));
          }
        }
      };

      this.worker.onerror = (error) => {
        console.error("[FluidClient] Worker error:", error);
        // Fallback to main thread on worker error
        this.useWorker = false;
        this.worker?.terminate();
        this.worker = undefined;
      };

      console.log(
        "[FluidClient] Web Worker initialized for signing operations",
      );
    } catch (error) {
      console.warn(
        "[FluidClient] Failed to initialize worker, falling back to main thread:",
        error,
      );
      this.useWorker = false;
    }
  }

  private async sendWorkerMessage(
    type: "sign_transaction" | "create_xdr",
    data: any,
    timeout: number = 30000,
  ): Promise<any> {
    if (!this.worker || !this.useWorker) {
      throw new Error("Worker not available");
    }

    const id = `req_${++this.requestIdCounter}`;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Worker operation timed out"));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout: timeoutId });

      const request: WorkerRequest = { id, type, data };
      this.worker!.postMessage(request);
    });
  }

  // Worker-based signing method
  private async signWithWorker(transaction: any): Promise<string> {
    try {
      // Extract transaction data for worker
      const transactionData = {
        transactionXdr: transaction.toXDR(),
        // Note: In a real implementation, you'd need to handle key extraction securely
        // This is a simplified example
        secretKey: "mock_key_for_demo", // This would need proper secure handling
      };

      const result = await this.sendWorkerMessage(
        "sign_transaction",
        transactionData,
      );
      return result.signedXdr;
    } catch (error) {
      console.error(
        "[FluidClient] Worker signing failed, falling back to main thread:",
        error,
      );
      throw error;
    }
  }

  // Main thread signing fallback
  private async signOnMainThread(
    transaction: any,
    keypair: any,
  ): Promise<string> {
    // Use existing Stellar SDK signing
    transaction.sign(keypair);
    return transaction.toXDR();
  }

  async requestFeeBump(
    signedTransactionXdr: string,
    submit: boolean = false,
  ): Promise<FeeBumpResponse> {
    const result = await this.requestWithFallback<FeeBumpResponse>("/fee-bump", {
      xdr: signedTransactionXdr,
      submit,
    });
    return {
      xdr: result.xdr,
      status: result.status,
      hash: result.hash,
    };
  }

  
  async submitFeeBumpTransaction(feeBumpXdr: string): Promise<any> {
    if (!this.horizonServer) {
      throw new Error("Horizon URL not configured");
    }

    const feeBumpTx = fromTransactionXdr(this.stellarSdk, feeBumpXdr, this.networkPassphrase);

    return await this.horizonServer.submitTransaction(feeBumpTx);
  }

  async waitForConfirmation(
    hash: string,
    timeoutMs: number = 60_000,
    options: WaitForConfirmationOptions = {}
  ): Promise<any> {
    if (!this.horizonUrl) {
      throw new Error("Horizon URL not configured");
    }

    const pollIntervalMs = options.pollIntervalMs ?? 1_500;
    const startedAt = Date.now();
    let attempt = 0;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    // Horizon returns 404 until the transaction is ingested.
    // Once found, the response includes a `ledger` number when confirmed.
    // Ref: GET /transactions/{hash}
    while (Date.now() - startedAt < timeoutMs) {
      attempt += 1;
      options.onProgress?.({
        hash,
        attempt,
        elapsedMs: Date.now() - startedAt,
      });

      const res = await fetch(`${this.horizonUrl}/transactions/${hash}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (res.status === 404) {
        await sleep(pollIntervalMs);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Horizon error while confirming tx (${res.status}): ${body}`
        );
      }

      const tx = await res.json();
      // If Horizon found it, it's confirmed on-ledger (Horizon only serves
      // transactions that have been included).
      return tx;
    }

    throw new Error(
      `Timed out waiting for transaction confirmation after ${timeoutMs}ms: ${hash}`
    );
  }

  async awaitTransactionConfirmation(
    hash: string,
    timeoutMs: number = 60_000,
    options: WaitForConfirmationOptions = {}
  ): Promise<any> {
    return this.waitForConfirmation(hash, timeoutMs, options);
  }

  
  async buildAndRequestFeeBump(
    transaction: any,
    keypair?: any,
    submit: boolean = false,
  ): Promise<FeeBumpResponse> {
    let signedXdr: string;

    if (this.useWorker && this.worker) {
      try {
        // Try worker-based signing
        signedXdr = await this.signWithWorker(transaction);
      } catch (error) {
        console.warn(
          "[FluidClient] Worker signing failed, using main thread fallback",
        );
        if (!keypair) {
          throw new Error("Keypair required for main thread signing fallback");
        }
        signedXdr = await this.signOnMainThread(transaction, keypair);
      }
    } else {
      // Use main thread signing
      if (!keypair) {
        throw new Error("Keypair required for signing");
      }
      signedXdr = await this.signOnMainThread(transaction, keypair);
    }

    return await this.requestFeeBump(signedXdr, submit);
  }

  async buildSACTransferTx(
    options: Omit<BuildSACTransferTxOptions, "networkPassphrase" | "sorobanServer">
  ): Promise<Transaction> {
    return buildSACTransferTxHelper({
      ...options,
      networkPassphrase: this.networkPassphrase,
      sorobanServer: this.sorobanServer,
    });
  }

  // New method for performance testing
  async signMultipleTransactions(
    transactions: any[],
    keypair?: any,
  ): Promise<string[]> {
    const results: string[] = [];

    for (const transaction of transactions) {
      if (this.useWorker && this.worker) {
        try {
          const signedXdr = await this.signWithWorker(transaction);
          results.push(signedXdr);
        } catch (error) {
          console.warn(
            "[FluidClient] Worker signing failed, using main thread fallback",
          );
          if (!keypair) {
            throw new Error(
              "Keypair required for main thread signing fallback",
            );
          }
          const signedXdr = await this.signOnMainThread(transaction, keypair);
          results.push(signedXdr);
        }
      } else {
        if (!keypair) {
          throw new Error("Keypair required for signing");
        }
        const signedXdr = await this.signOnMainThread(transaction, keypair);
        results.push(signedXdr);
      }
    }

    return results;
  }

  // Cleanup method
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
    this.pendingRequests.clear();
  }
}

export * from "./soroban";
export {
  collectTelemetry,
  createTelemetryCollector,
  isTelemetryEnabled,
  getTelemetryConfig,
} from "./telemetry";
export type { TelemetryConfig, TelemetryData } from "./telemetry";

export { FluidQueue } from "./queue";
export type { QueuedTransaction, FluidQueueCallbacks } from "./queue";
export {
  buildFeeBumpTransaction,
  createHorizonServer,
  fromTransactionXdr,
  getSdkFamily,
  isTransactionLike,
  resolveStellarSdk,
  toTransactionXdr,
} from "./stellarCompatibility";

// Example usage
async function main() {
  const client = new FluidClient({
    serverUrl: process.env.FLUID_SERVER_URL || "http://localhost:3000",
    networkPassphrase: StellarSdk.Networks.TESTNET,
    horizonUrl: "https://horizon-testnet.stellar.org",
  });

  // Example: create a transaction
  const userKeypair = StellarSdk.Keypair.random();
  console.log("User wallet:", userKeypair.publicKey());

  // fund the wallet (onlyon testnet )
  await fetch(`https://friendbot.stellar.org?addr=${userKeypair.publicKey()}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org",
  );
  const account = await server.loadAccount(userKeypair.publicKey());

  // Build transaction
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: StellarSdk.Keypair.random().publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "5",
      }),
    )
    .setTimeout(180)
    .build();

  // Sign transaction
  transaction.sign(userKeypair);

  // Request fee-bump
  const result = await client.requestFeeBump(transaction.toXDR(), false);
  console.log("Fee-bump XDR received:", result.xdr.substring(0, 50) + "...");

  // Submit fee-bump transaction
  const submitResult = await client.submitFeeBumpTransaction(result.xdr);
  console.log("Transaction submitted! Hash:", submitResult.hash);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch(console.error);
}
