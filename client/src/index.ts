import StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

/**
 * Configuration options for initializing the FluidClient.
 */
export interface FluidClientConfig {
  /** The URL of the Fluid fee-bump server. */
  serverUrl: string;
  /** The Stellar network passphrase (e.g. Testnet or Mainnet). */
  networkPassphrase: string;
  /** Optional Horizon server URL for transaction submission. */
  horizonUrl?: string;
}

/**
 * Response returned after requesting a fee-bump transaction.
 */
export interface FeeBumpResponse {
  /** The XDR-encoded fee-bump transaction. */
  xdr: string;
  /** Status of the fee-bump request. */
  status: string;
  /** Optional transaction hash if submitted. */
  hash?: string;
}

/**
 * FluidClient is the main entry point for interacting with the Fluid
 * gasless transaction service on the Stellar network.
 *
 * @example
 * ```ts
 * const client = new FluidClient({
 *   serverUrl: "https://fluid-server.example.com",
 *   networkPassphrase: Networks.TESTNET,
 *   horizonUrl: "https://horizon-testnet.stellar.org",
 * });
 * ```
 */
export class FluidClient {
  private serverUrl: string;
  private networkPassphrase: string;
  private horizonServer?: any;

  /**
   * Creates a new FluidClient instance.
   * @param config - Configuration options for the client.
   */
  constructor(config: FluidClientConfig) {
    this.serverUrl = config.serverUrl;
    this.networkPassphrase = config.networkPassphrase;
    if (config.horizonUrl) {
      this.horizonServer = new StellarSdk.Horizon.Server(config.horizonUrl);
    }
  }

  /**
   * Requests a fee-bump transaction from the Fluid server.
   *
   * @param signedTransactionXdr - The XDR of the inner signed transaction.
   * @param submit - Whether the server should auto-submit the fee-bump. Defaults to `false`.
   * @returns A promise resolving to a {@link FeeBumpResponse}.
   *
   * @example
   * ```ts
   * const result = await client.requestFeeBump(transaction.toXDR(), false);
   * console.log(result.xdr);
   * ```
   */
  async requestFeeBump(
    signedTransactionXdr: string,
    submit: boolean = false
  ): Promise<FeeBumpResponse> {
    const response = await fetch(`${this.serverUrl}/fee-bump`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xdr: signedTransactionXdr, submit }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Fluid server error: ${JSON.stringify(error)}`);
    }

    const result = (await response.json()) as FeeBumpResponse;
    return { xdr: result.xdr, status: result.status, hash: result.hash };
  }

  /**
   * Submits an already-wrapped fee-bump transaction to the Stellar network
   * via the configured Horizon server.
   *
   * @param feeBumpXdr - The XDR of the fee-bump transaction to submit.
   * @returns The Horizon submission response.
   * @throws If no Horizon URL was provided during initialization.
   */
  async submitFeeBumpTransaction(feeBumpXdr: string): Promise<any> {
    if (!this.horizonServer) {
      throw new Error("Horizon URL not configured");
    }
    const feeBumpTx = StellarSdk.TransactionBuilder.fromXDR(
      feeBumpXdr,
      this.networkPassphrase
    );
    return await this.horizonServer.submitTransaction(feeBumpTx);
  }

  /**
   * Convenience method that wraps a transaction into XDR and requests
   * a fee-bump from the Fluid server in one step.
   *
   * @param transaction - A built and signed Stellar transaction object.
   * @param submit - Whether to auto-submit after wrapping. Defaults to `false`.
   * @returns A promise resolving to a {@link FeeBumpResponse}.
   */
  async buildAndRequestFeeBump(
    transaction: any,
    submit: boolean = false
  ): Promise<FeeBumpResponse> {
    const signedXdr = transaction.toXDR();
    return await this.requestFeeBump(signedXdr, submit);
  }
}
