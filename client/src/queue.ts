import { FluidClient, FeeBumpResponse } from "./index";

/**
 * Represents a single queued transaction waiting to be submitted.
 */
export interface QueuedTransaction {
  /** Unique identifier for this queued item. */
  id: string;
  /** The XDR-encoded signed transaction. */
  xdr: string;
  /** Whether to auto-submit after fee-bump. */
  submit: boolean;
  /** Unix timestamp when the transaction was queued. */
  queuedAt: number;
  /** Number of retry attempts made. */
  retryCount: number;
}

/**
 * Callbacks for monitoring queue activity.
 */
export interface FluidQueueCallbacks {
  /** Called when a transaction is successfully processed. */
  onSuccess?: (id: string, response: FeeBumpResponse) => void;
  /** Called when a transaction fails after all retries. */
  onError?: (id: string, error: Error) => void;
  /** Called when the entire queue has been flushed. */
  onQueueCleared?: () => void;
}

/**
 * FluidQueue manages offline queueing of fee-bump transactions.
 * It persists queued XDRs to localStorage and automatically retries
 * them when internet connectivity is restored.
 *
 * @example
 * ```ts
 * const queue = new FluidQueue(client, {
 *   onSuccess: (id, res) => console.log("Sent!", id, res),
 *   onQueueCleared: () => console.log("All transactions sent!"),
 * });
 *
 * // Queue a transaction (works offline too)
 * await queue.add(signedXdr, false);
 * ```
 */
export class FluidQueue {
  private client: FluidClient;
  private storageKey: string;
  private callbacks: FluidQueueCallbacks;
  private maxRetries: number;
  private isFlushing: boolean = false;

  /**
   * Creates a new FluidQueue instance and starts listening for
   * network connectivity events.
   *
   * @param client - A configured {@link FluidClient} instance.
   * @param callbacks - Optional callbacks for queue events.
   * @param storageKey - localStorage key to persist the queue. Defaults to `"fluid_queue"`.
   * @param maxRetries - Maximum retry attempts per transaction. Defaults to `3`.
   */
  constructor(
    client: FluidClient,
    callbacks: FluidQueueCallbacks = {},
    storageKey: string = "fluid_queue",
    maxRetries: number = 3
  ) {
    this.client = client;
    this.callbacks = callbacks;
    this.storageKey = storageKey;
    this.maxRetries = maxRetries;

    // Listen for connectivity restoration
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        console.log("[FluidQueue] Back online — flushing queue...");
        this.flush();
      });
    }

    // Auto-flush if already online on init
    if (typeof window === "undefined" || window.navigator.onLine) {
      this.flush();
    }
  }

  /**
   * Adds a signed transaction XDR to the queue.
   * If online, immediately attempts to process it.
   * If offline, persists it to localStorage for later.
   *
   * @param xdr - The XDR-encoded signed transaction.
   * @param submit - Whether to auto-submit after fee-bump.
   * @returns The unique ID assigned to this queued transaction.
   */
  async add(xdr: string, submit: boolean = false): Promise<string> {
    const item: QueuedTransaction = {
      id: `fluid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      xdr,
      submit,
      queuedAt: Date.now(),
      retryCount: 0,
    };

    this.saveToStorage(item);
    console.log(`[FluidQueue] Transaction queued: ${item.id}`);

    // Try immediately if online
    if (typeof window === "undefined" || window.navigator.onLine) {
      await this.flush();
    } else {
      console.log("[FluidQueue] Offline — transaction saved for later.");
    }

    return item.id;
  }

  /**
   * Returns all currently queued transactions.
   */
  getQueue(): QueuedTransaction[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * Returns the number of transactions currently in the queue.
   */
  size(): number {
    return this.getQueue().length;
  }

  /**
   * Clears all queued transactions from storage.
   */
  clear(): void {
    localStorage.removeItem(this.storageKey);
    console.log("[FluidQueue] Queue cleared.");
  }

  /**
   * Attempts to process all queued transactions in order.
   * Skips if already flushing or if offline.
   */
  async flush(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;

    const queue = this.getQueue();
    if (queue.length === 0) {
      this.isFlushing = false;
      return;
    }

    console.log(`[FluidQueue] Flushing ${queue.length} queued transaction(s)...`);

    for (const item of queue) {
      await this.processItem(item);
    }

    if (this.getQueue().length === 0) {
      console.log("[FluidQueue] Queue cleared!");
      this.callbacks.onQueueCleared?.();
    }

    this.isFlushing = false;
  }

  // ---- Private helpers ----

  private async processItem(item: QueuedTransaction): Promise<void> {
    // Check if transaction has expired (Stellar txns expire after ~timeout)
    const AGE_LIMIT_MS = 3 * 60 * 1000; // 3 minutes
    if (Date.now() - item.queuedAt > AGE_LIMIT_MS) {
      console.warn(`[FluidQueue] Transaction ${item.id} expired, removing.`);
      this.removeFromStorage(item.id);
      return;
    }

    try {
      const response = await this.client.requestFeeBump(item.xdr, item.submit);
      console.log(`[FluidQueue] Transaction ${item.id} succeeded!`);
      this.removeFromStorage(item.id);
      this.callbacks.onSuccess?.(item.id, response);
    } catch (error) {
      item.retryCount++;
      if (item.retryCount >= this.maxRetries) {
        console.error(`[FluidQueue] Transaction ${item.id} failed after ${this.maxRetries} retries.`);
        this.removeFromStorage(item.id);
        this.callbacks.onError?.(item.id, error as Error);
      } else {
        console.warn(`[FluidQueue] Retry ${item.retryCount}/${this.maxRetries} for ${item.id}`);
        this.updateInStorage(item);
      }
    }
  }

  private saveToStorage(item: QueuedTransaction): void {
    const queue = this.getQueue();
    queue.push(item);
    localStorage.setItem(this.storageKey, JSON.stringify(queue));
  }

  private removeFromStorage(id: string): void {
    const queue = this.getQueue().filter((i) => i.id !== id);
    localStorage.setItem(this.storageKey, JSON.stringify(queue));
  }

  private updateInStorage(updated: QueuedTransaction): void {
    const queue = this.getQueue().map((i) => (i.id === updated.id ? updated : i));
    localStorage.setItem(this.storageKey, JSON.stringify(queue));
  }
}
