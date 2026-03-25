import test from "node:test";
import assert from "node:assert/strict";
import StellarSdk from "@stellar/stellar-sdk";
import { nativeSigner } from "./native";
import { SignerPool } from "./signerPool";

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

test("SignerPool signs concurrently across five distinct accounts", async () => {
  const keypairs = Array.from({ length: 5 }, () => StellarSdk.Keypair.random());
  const pool = new SignerPool(
    keypairs.map((keypair, index) => ({
      initialSequenceNumber: BigInt(index + 1),
      keypair,
      secret: keypair.secret(),
    })),
    {
      lowBalanceThreshold: 50n,
      selectionStrategy: "least_used",
    }
  );

  await pool.updateBalance(keypairs[0].publicKey(), 500n);
  await pool.updateBalance(keypairs[1].publicKey(), 500n);
  await pool.updateBalance(keypairs[2].publicKey(), 500n);
  await pool.updateBalance(keypairs[3].publicKey(), 500n);
  await pool.updateBalance(keypairs[4].publicKey(), 500n);

  const barrier = createDeferred();
  const acquisitions: Array<{ publicKey: string; sequence: string | null; txId: string }> = [];

  const signingTasks = Array.from({ length: 5 }, (_, index) =>
    pool.withSigner(async (lease) => {
      const txId = `tx-${index + 1}`;
      const sequence = lease.reservedSequenceNumber?.toString() ?? null;
      acquisitions.push({
        publicKey: lease.account.publicKey,
        sequence,
        txId,
      });

      console.log(
        `POOL_TEST acquire tx=${txId} account=${lease.account.publicKey} sequence=${sequence}`
      );

      if (acquisitions.length === 5) {
        barrier.resolve();
      }

      await barrier.promise;

      const signature = await nativeSigner.signPayload(
        lease.account.secret,
        Buffer.from(`payload-${txId}`)
      );

      console.log(
        `POOL_TEST signed tx=${txId} account=${lease.account.publicKey} signature_bytes=${signature.length}`
      );

      return {
        publicKey: lease.account.publicKey,
        sequence,
        signature: signature.toString("base64"),
        txId,
      };
    })
  );

  const results = await Promise.all(signingTasks);
  const distinctAccounts = new Set(results.map((result) => result.publicKey));
  assert.equal(distinctAccounts.size, 5);
  assert.deepEqual(
    results.map((result) => result.sequence),
    ["1", "2", "3", "4", "5"]
  );

  const loadTestTasks = Array.from({ length: 200 }, (_, index) =>
    pool.withSigner(async (lease) => {
      const signature = await nativeSigner.signPayload(
        lease.account.secret,
        Buffer.from(`bulk-payload-${index}`)
      );

      return {
        publicKey: lease.account.publicKey,
        signature: signature.toString("base64"),
      };
    })
  );

  const loadTestResults = await Promise.all(loadTestTasks);
  assert.equal(loadTestResults.length, 200);
  assert.equal(
    new Set(loadTestResults.map((result) => result.publicKey)).size,
    5
  );

  await pool.updateBalance(keypairs[0].publicKey(), 10n);
  const snapshot = pool.getSnapshot();
  const deactivated = snapshot.find(
    (account) => account.publicKey === keypairs[0].publicKey()
  );

  assert.equal(deactivated?.active, false);
  assert.equal(
    snapshot.filter((account) => account.active).length,
    4
  );
});
