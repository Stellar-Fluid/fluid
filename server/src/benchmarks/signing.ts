import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import StellarSdk from "@stellar/stellar-sdk";
import { signTransaction, signTransactionWithNode } from "../signing";

interface BenchmarkResult {
  avgMs: number;
  maxMs: number;
  minMs: number;
  name: string;
  opsPerSec: number;
  p50Ms: number;
  p95Ms: number;
}

const ITERATIONS = 5_000;
const WARMUP_ITERATIONS = 500;
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

type FeeBumpTransaction = ReturnType<
  typeof StellarSdk.TransactionBuilder.buildFeeBumpTransaction
>;
type Keypair = ReturnType<typeof StellarSdk.Keypair.random>;

function percentile(sortedValues: number[], percentileValue: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.floor(sortedValues.length * percentileValue)
  );
  return sortedValues[index];
}

function summarize(name: string, durationsNs: number[]): BenchmarkResult {
  const sorted = [...durationsNs].sort((left, right) => left - right);
  const totalNs = durationsNs.reduce((sum, duration) => sum + duration, 0);
  const avgNs = totalNs / durationsNs.length;

  return {
    avgMs: avgNs / 1_000_000,
    maxMs: sorted[sorted.length - 1] / 1_000_000,
    minMs: sorted[0] / 1_000_000,
    name,
    opsPerSec: 1_000_000_000 / avgNs,
    p50Ms: percentile(sorted, 0.5) / 1_000_000,
    p95Ms: percentile(sorted, 0.95) / 1_000_000,
  };
}

function buildUnsignedFeeBumpTransaction(
  userKeypair: Keypair,
  feePayerPublicKey: string
): FeeBumpTransaction {
  const sourceAccount = new StellarSdk.Account(userKeypair.publicKey(), "1");
  const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        amount: "1",
        asset: StellarSdk.Asset.native(),
        destination: feePayerPublicKey,
      })
    )
    .setTimeout(30)
    .build();

  innerTransaction.sign(userKeypair);

  return StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    feePayerPublicKey,
    "200",
    innerTransaction,
    NETWORK_PASSPHRASE
  );
}

function resetSignatures(transaction: FeeBumpTransaction): void {
  transaction.signatures.length = 0;
}

async function benchmark(
  name: string,
  signer: (transaction: FeeBumpTransaction) => Promise<void> | void
): Promise<BenchmarkResult> {
  const userKeypair = StellarSdk.Keypair.random();
  const feePayerKeypair = StellarSdk.Keypair.random();
  const transaction = buildUnsignedFeeBumpTransaction(
    userKeypair,
    feePayerKeypair.publicKey()
  );

  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
    resetSignatures(transaction);
    await signer(transaction);
  }

  const durationsNs: number[] = [];

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    resetSignatures(transaction);
    const start = process.hrtime.bigint();
    await signer(transaction);
    const durationNs = Number(process.hrtime.bigint() - start);

    if (transaction.signatures.length !== 1) {
      throw new Error(`${name} produced ${transaction.signatures.length} signatures`);
    }

    durationsNs.push(durationNs);
  }

  return summarize(name, durationsNs);
}

async function verifyParity(secret: string): Promise<void> {
  const userKeypair = StellarSdk.Keypair.random();
  const feePayerKeypair = StellarSdk.Keypair.fromSecret(secret);

  const nodeTransaction = buildUnsignedFeeBumpTransaction(
    userKeypair,
    feePayerKeypair.publicKey()
  );
  const rustTransaction = buildUnsignedFeeBumpTransaction(
    userKeypair,
    feePayerKeypair.publicKey()
  );

  signTransactionWithNode(nodeTransaction, secret);
  await signTransaction(rustTransaction, secret, NETWORK_PASSPHRASE);

  const nodeSignature = Buffer.from(
    nodeTransaction.signatures[0]?.signature() ?? []
  ).toString("base64");
  const rustSignature = Buffer.from(
    rustTransaction.signatures[0]?.signature() ?? []
  ).toString("base64");

  if (!nodeSignature || !rustSignature || nodeSignature !== rustSignature) {
    throw new Error("Rust and Node signers produced different signatures");
  }
}

function toTableRow(result: BenchmarkResult, baselineAvgMs: number): string {
  const speedup = baselineAvgMs / result.avgMs;
  return `| ${result.name} | ${result.avgMs.toFixed(4)} | ${result.p50Ms.toFixed(
    4
  )} | ${result.p95Ms.toFixed(4)} | ${result.opsPerSec.toFixed(2)} | ${speedup.toFixed(
    2
  )}x |`;
}

async function main(): Promise<void> {
  const feePayerKeypair = StellarSdk.Keypair.random();
  const feePayerSecret = feePayerKeypair.secret();

  await verifyParity(feePayerSecret);

  const nodeResult = await benchmark("Node stellar-sdk", async (transaction) => {
    signTransactionWithNode(transaction, feePayerSecret);
  });
  const rustResult = await benchmark("Rust ed25519-dalek", async (transaction) => {
    await signTransaction(transaction, feePayerSecret, NETWORK_PASSPHRASE);
  });

  const report = [
    "# Signing Benchmark Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Iterations: ${ITERATIONS}`,
    `Warmup iterations: ${WARMUP_ITERATIONS}`,
    "",
    "| Implementation | Avg (ms) | P50 (ms) | P95 (ms) | Ops/sec | Relative to Node |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    toTableRow(nodeResult, nodeResult.avgMs),
    toTableRow(rustResult, nodeResult.avgMs),
    "",
    `Node min/max: ${nodeResult.minMs.toFixed(4)} ms / ${nodeResult.maxMs.toFixed(4)} ms`,
    `Rust min/max: ${rustResult.minMs.toFixed(4)} ms / ${rustResult.maxMs.toFixed(4)} ms`,
    "",
    "Methodology:",
    "- Builds one unsigned fee-bump transaction per benchmark run.",
    "- Signs the same transaction repeatedly after clearing signatures to isolate signing latency.",
    "- Verifies parity first to ensure the Rust signer produces the same Ed25519 signature over the Stellar transaction hash as the current Node implementation.",
    "",
  ].join("\n");

  const reportPath = resolve(__dirname, "../../benchmarks/signing-report.md");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report, "utf8");

  console.log(report);
  console.log(`\nReport written to ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
