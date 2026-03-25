export interface TransactionRecord {
  hash: string;
  tenantId: string;
  status: 'pending' | 'submitted' | 'success' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

// Simple in-memory storage for transactions
// In production, this should be replaced with a proper database
class TransactionStore {
  private transactions: Map<string, TransactionRecord> = new Map();

  addTransaction(hash: string, tenantId: string, status: 'pending' | 'submitted'): void {
    const record: TransactionRecord = {
      hash,
      tenantId,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.transactions.set(hash, record);
    console.log(`[TransactionStore] Added transaction ${hash} with status ${status}`);
  }

  updateTransactionStatus(hash: string, status: 'success' | 'failed'): void {
    const record = this.transactions.get(hash);
    if (record) {
      record.status = status;
      record.updatedAt = new Date();
      console.log(`[TransactionStore] Updated transaction ${hash} to status ${status}`);
    } else {
      console.log(`[TransactionStore] Transaction ${hash} not found for status update`);
    }
  }

  getPendingTransactions(): TransactionRecord[] {
    const pending = Array.from(this.transactions.values())
      .filter(tx => tx.status === 'pending' || tx.status === 'submitted');
    console.log(`[TransactionStore] Found ${pending.length} pending/submitted transactions`);
    return pending;
  }

  getTransaction(hash: string): TransactionRecord | undefined {
    return this.transactions.get(hash);
  }

  getAllTransactions(): TransactionRecord[] {
    return Array.from(this.transactions.values());
  }
}

export const transactionStore = new TransactionStore();
