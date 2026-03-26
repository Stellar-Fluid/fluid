import StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import {
  createHorizonServer,
  fromTransactionXdr,
  resolveStellarSdk,
  toTransactionXdr,
} from "./stellarCompatibility";

dotenv.config();

export interface FluidClientConfig {
  serverUrl: string;
  networkPassphrase: string;
  horizonUrl?: string;
  stellarSdk?: unknown;
}

export interface FeeBumpResponse {
  xdr: string;
  status: string;
  hash?: string;
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

export class FluidClient {
  private serverUrl: string;
  private networkPassphrase: string;
  private horizonServer?: any;
  private horizonUrl?: string;
  private stellarSdk: unknown;

  constructor(config: FluidClientConfig) {
    this.serverUrl = config.serverUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.stellarSdk = resolveStellarSdk(config.stellarSdk ?? StellarSdk);
    if (config.horizonUrl) {
      this.horizonServer = createHorizonServer(this.stellarSdk, config.horizonUrl);
    }
  }

  
  async requestFeeBump(
    signedTransactionXdr: string,
    submit: boolean = false
  ): Promise<FeeBumpResponse> {
    const response = await fetch(`${this.serverUrl}/fee-bump`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        xdr: signedTransactionXdr,
        submit: submit,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Fluid server error: ${JSON.stringify(error)}`);
    }

    const result = (await response.json()) as FeeBumpResponse;
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
    submit: boolean = false
  ): Promise<FeeBumpResponse> {
    const signedXdr = toTransactionXdr(transaction);
    return await this.requestFeeBump(signedXdr, submit);
  }
}

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
  await fetch(
    `https://friendbot.stellar.org?addr=${userKeypair.publicKey()}`
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org"
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
      })
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

if (require.main === module) {
  main().catch(console.error);
}
