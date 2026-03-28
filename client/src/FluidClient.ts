import StellarSdk, { Horizon, Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk";

export interface FluidClientConfig {
  serverUrl?: string;
  serverUrls?: string[];
  networkPassphrase: string;
  horizonUrl?: string;
}

export interface FeeBumpResponse {
  xdr: string;
  status: "ready" | "submitted";
  hash?: string;
  fee_payer?: string;
  submitted_via?: string;
  submission_attempts?: number;
}

export interface FeeBumpRequestBody {
  xdr: string;
  submit?: boolean;
}

export interface FeeBumpBatchRequestBody {
  xdrs: string[];
  submit?: boolean;
}

export type XdrSerializableTransaction = {
  toXDR: () => string;
};

export type FeeBumpRequestInput = string | XdrSerializableTransaction;

type RequestError = Error & {
  status?: number;
  serverUrl?: string;
};

export class FluidClient {
  private readonly serverUrls: string[];
  private readonly networkPassphrase: string;
  private readonly horizonServer?: Horizon.Server;
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

    if (config.horizonUrl) {
      this.horizonServer = new StellarSdk.Horizon.Server(config.horizonUrl);
    }
  }

  private serializeTransaction(input: FeeBumpRequestInput): string {
    return typeof input === "string" ? input : input.toXDR();
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
        "FluidClient requires at least one server URL via serverUrl or serverUrls"
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
      this.maxRetryDelayMs
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async performJsonRequest<T>(
    serverUrl: string,
    path: string,
    body: unknown
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
        `Fluid server request failed: ${error instanceof Error ? error.message : String(error)}`
      ) as RequestError;
      requestError.serverUrl = serverUrl;
      throw requestError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const requestError = new Error(
        this.formatServerErrorMessage(response, errorText)
      ) as RequestError;
      requestError.status = response.status;
      requestError.serverUrl = serverUrl;
      throw requestError;
    }

    return (await response.json()) as T;
  }

  private formatServerErrorMessage(response: Response, errorText: string): string {
    try {
      const parsed = JSON.parse(errorText) as Record<string, unknown>;
      return `Fluid server error: ${JSON.stringify(parsed)}`;
    } catch {
      return `Fluid server error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`;
    }
  }

  private async requestWithFallback<T>(path: string, body: unknown): Promise<T> {
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
            `[FluidClient] Request failed on ${serverUrl} (${requestError.message}). Retrying ${path} on ${nextServerUrl} in ${retryDelayMs}ms.`
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

  async requestFeeBump(
    transaction: FeeBumpRequestInput,
    submit: boolean = false
  ): Promise<FeeBumpResponse> {
    return this.requestWithFallback<FeeBumpResponse>("/fee-bump", {
        xdr: this.serializeTransaction(transaction),
        submit,
      } satisfies FeeBumpRequestBody);
  }

  async requestFeeBumpBatch(
    transactions: FeeBumpRequestInput[],
    submit: boolean = false
  ): Promise<FeeBumpResponse[]> {
    return this.requestWithFallback<FeeBumpResponse[]>("/fee-bump/batch", {
        xdrs: transactions.map((t) => this.serializeTransaction(t)),
        submit,
      } satisfies FeeBumpBatchRequestBody);
  }

  async submitFeeBumpTransaction(
    feeBumpXdr: string
  ): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
    if (!this.horizonServer) {
      throw new Error("Horizon URL not configured");
    }

    const feeBumpTx = StellarSdk.TransactionBuilder.fromXDR(
      feeBumpXdr,
      this.networkPassphrase
    ) as Transaction | FeeBumpTransaction;

    return this.horizonServer.submitTransaction(feeBumpTx);
  }

  async buildAndRequestFeeBump(
    transaction: XdrSerializableTransaction,
    submit: boolean = false
  ): Promise<FeeBumpResponse> {
    return this.requestFeeBump(transaction, submit);
  }
}
