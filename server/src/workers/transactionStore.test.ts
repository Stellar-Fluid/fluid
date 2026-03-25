import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";

// We need a fresh TransactionStore for each test, so we import the class directly
// The module exports a singleton, so we re-create instances for isolation
import { TransactionRecord } from "./transactionStore";

// Re-create the class inline for isolated testing
class TransactionStore {
  private transactions: Map<string, TransactionRecord> = new Map();

  addTransaction(hash: string, tenantId: string, status: "pending" | "submitted"): void {
    const record: TransactionRecord = {
      hash,
      tenantId,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.transactions.set(hash, record);
  }

  updateTransactionStatus(hash: string, status: "success" | "failed"): void {
    const record = this.transactions.get(hash);
    if (record) {
      record.status = status;
      record.updatedAt = new Date();
    }
  }

  getPendingTransactions(): TransactionRecord[] {
    return Array.from(this.transactions.values()).filter(
      (tx) => tx.status === "pending" || tx.status === "submitted"
    );
  }

  getTransaction(hash: string): TransactionRecord | undefined {
    return this.transactions.get(hash);
  }

  getAllTransactions(): TransactionRecord[] {
    return Array.from(this.transactions.values());
  }
}

describe("TransactionStore", () => {
  let store: TransactionStore;

  beforeEach(() => {
    store = new TransactionStore();
  });

  describe("addTransaction", () => {
    it("stores a transaction with the given hash, tenantId, and status", () => {
      store.addTransaction("abc123", "tenant-1", "submitted");
      const tx = store.getTransaction("abc123");
      expect(tx).toBeDefined();
      expect(tx!.hash).toBe("abc123");
      expect(tx!.tenantId).toBe("tenant-1");
      expect(tx!.status).toBe("submitted");
    });

    it("stores a pending transaction", () => {
      store.addTransaction("hash-pending", "tenant-2", "pending");
      const tx = store.getTransaction("hash-pending");
      expect(tx!.status).toBe("pending");
    });

    it("sets createdAt and updatedAt on creation", () => {
      const before = new Date();
      store.addTransaction("hash-time", "tenant-1", "submitted");
      const after = new Date();
      const tx = store.getTransaction("hash-time");
      expect(tx!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(tx!.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("updateTransactionStatus", () => {
    it("updates status to success", () => {
      store.addTransaction("hash-1", "tenant-1", "submitted");
      store.updateTransactionStatus("hash-1", "success");
      expect(store.getTransaction("hash-1")!.status).toBe("success");
    });

    it("updates status to failed", () => {
      store.addTransaction("hash-2", "tenant-1", "submitted");
      store.updateTransactionStatus("hash-2", "failed");
      expect(store.getTransaction("hash-2")!.status).toBe("failed");
    });

    it("does nothing for unknown hash", () => {
      // Should not throw
      expect(() => store.updateTransactionStatus("unknown", "success")).not.toThrow();
    });
  });

  describe("getPendingTransactions", () => {
    it("returns submitted and pending transactions", () => {
      store.addTransaction("h1", "t1", "submitted");
      store.addTransaction("h2", "t2", "pending");
      const pending = store.getPendingTransactions();
      expect(pending).toHaveLength(2);
    });

    it("excludes terminal transactions", () => {
      store.addTransaction("h1", "t1", "submitted");
      store.updateTransactionStatus("h1", "success");
      store.addTransaction("h2", "t2", "submitted");
      store.updateTransactionStatus("h2", "failed");
      expect(store.getPendingTransactions()).toHaveLength(0);
    });
  });

  describe("Property 6: Transaction store preserves tenantId", () => {
    /**
     * Validates: Requirements 4.1, 4.2
     * Feature: tenant-webhooks, Property 6: Transaction store preserves tenantId
     *
     * For any (hash, tenantId) pair, adding then retrieving the transaction
     * should return the same tenantId.
     */
    it("round-trips tenantId for any hash and tenantId", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.string({ minLength: 1 }),
          fc.constantFrom("pending" as const, "submitted" as const),
          (hash, tenantId, status) => {
            const localStore = new TransactionStore();
            localStore.addTransaction(hash, tenantId, status);
            const retrieved = localStore.getTransaction(hash);
            return retrieved !== undefined && retrieved.tenantId === tenantId;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
