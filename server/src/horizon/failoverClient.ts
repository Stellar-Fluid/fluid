import StellarSdk from "@stellar/stellar-sdk";
import {
  Config,
  HorizonSelectionStrategy,
} from "../config";

export type HorizonNodeState = "Active" | "Inactive";

export interface HorizonNodeStatus {
  url: string;
  state: HorizonNodeState;
  consecutiveFailures: number;
  lastError?: string;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
}

interface HorizonNodeRuntimeState {
  server: any;
  status: HorizonNodeStatus;
}

export interface HorizonSubmissionResult {
  result: any;
  nodeUrl: string;
  attempts: number;
}

type RetryDisposition = "retryable" | "final";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getStatusCode(error: any): number | undefined {
  return (
    error?.response?.status ||
    error?.response?.statusCode ||
    error?.status ||
    error?.statusCode
  );
}

function getErrorCode(error: any): string | undefined {
  return error?.code || error?.cause?.code;
}

function classifySubmissionError(error: any): RetryDisposition {
  const statusCode = getStatusCode(error);

  if (statusCode !== undefined) {
    if ([408, 429, 500, 502, 503, 504].includes(statusCode)) {
      return "retryable";
    }

    if (statusCode >= 400 && statusCode < 500) {
      return "final";
    }
  }

  const errorCode = getErrorCode(error);
  if (
    errorCode &&
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(errorCode)
  ) {
    return "retryable";
  }

  const message = formatError(error).toLowerCase();
  if (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("socket") ||
    message.includes("fetch failed") ||
    message.includes("connection refused")
  ) {
    return "retryable";
  }

  return "final";
}

export class HorizonFailoverClient {
  private readonly nodes: HorizonNodeRuntimeState[];
  private readonly strategy: HorizonSelectionStrategy;
  private roundRobinIndex = 0;

  constructor(urls: string[], strategy: HorizonSelectionStrategy = "priority") {
    if (urls.length === 0) {
      throw new Error("At least one Horizon URL is required");
    }

    this.strategy = strategy;
    this.nodes = urls.map((url) => ({
      server: new StellarSdk.Horizon.Server(url),
      status: {
        url,
        state: "Active",
        consecutiveFailures: 0,
      },
    }));
  }

  static fromConfig(config: Config): HorizonFailoverClient {
    return new HorizonFailoverClient(
      config.horizonUrls,
      config.horizonSelectionStrategy
    );
  }

  getNodeStatuses(): HorizonNodeStatus[] {
    return this.nodes.map((node) => ({ ...node.status }));
  }

  async submitTransaction(
    transaction: any
  ): Promise<HorizonSubmissionResult> {
    const orderedNodes = this.getOrderedNodes();
    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex < orderedNodes.length; attemptIndex += 1) {
      const node = orderedNodes[attemptIndex];
      const attemptNumber = attemptIndex + 1;

      console.log(
        `[HorizonFailover] Submit attempt ${attemptNumber}/${orderedNodes.length} via ${node.status.url}`
      );

      try {
        const result = await node.server.submitTransaction(transaction);
        this.markNodeActive(node);
        console.log(
          `[HorizonFailover] Submission succeeded on ${node.status.url} with hash ${result.hash}`
        );

        return {
          result,
          nodeUrl: node.status.url,
          attempts: attemptNumber,
        };
      } catch (error: any) {
        lastError = error;
        const disposition = classifySubmissionError(error);
        this.markNodeInactive(node, error);
        console.warn(
          `[HorizonFailover] Submission failed on ${node.status.url} (${disposition}) - ${formatError(error)}`
        );

        if (disposition === "final") {
          throw error;
        }
      }
    }

    throw lastError;
  }

  async getTransaction(
    hash: string
  ): Promise<any> {
    const orderedNodes = this.getOrderedNodes();
    let lastError: unknown;

    for (const node of orderedNodes) {
      try {
        const result = await node.server.transactions().transaction(hash).call();
        this.markNodeActive(node);
        return result;
      } catch (error: any) {
        lastError = error;
        const disposition = classifySubmissionError(error);

        if (disposition === "retryable") {
          this.markNodeInactive(node, error);
          console.warn(
            `[HorizonFailover] Transaction lookup failed on ${node.status.url} (retryable) - ${formatError(error)}`
          );
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  private getOrderedNodes(): HorizonNodeRuntimeState[] {
    if (this.strategy === "round_robin") {
      const start = this.roundRobinIndex % this.nodes.length;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % this.nodes.length;

      return this.nodes.map((_, offset) => this.nodes[(start + offset) % this.nodes.length]);
    }

    const activeNodes = this.nodes.filter((node) => node.status.state === "Active");
    const inactiveNodes = this.nodes.filter((node) => node.status.state === "Inactive");
    return [...activeNodes, ...inactiveNodes];
  }

  private markNodeActive(node: HorizonNodeRuntimeState): void {
    node.status.state = "Active";
    node.status.consecutiveFailures = 0;
    node.status.lastError = undefined;
    node.status.lastCheckedAt = new Date().toISOString();
    node.status.lastSuccessAt = node.status.lastCheckedAt;
    console.log(`[HorizonFailover] Node ${node.status.url} status => Active`);
  }

  private markNodeInactive(node: HorizonNodeRuntimeState, error: unknown): void {
    node.status.state = "Inactive";
    node.status.consecutiveFailures += 1;
    node.status.lastError = formatError(error);
    node.status.lastCheckedAt = new Date().toISOString();
    console.log(`[HorizonFailover] Node ${node.status.url} status => Inactive`);
  }
}

let sharedClient: HorizonFailoverClient | null = null;

export function initializeHorizonFailoverClient(
  config: Config
): HorizonFailoverClient {
  sharedClient = HorizonFailoverClient.fromConfig(config);
  return sharedClient;
}

export function getHorizonFailoverClient(): HorizonFailoverClient | null {
  return sharedClient;
}
