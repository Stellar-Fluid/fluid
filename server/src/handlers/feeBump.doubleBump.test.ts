import assert from "node:assert";
import StellarSdk from "@stellar/stellar-sdk";
import type { Config } from "../config";

async function testRejectDoubleBumpedTransaction(): Promise<void> {
  // This test exercises the rejection path, which happens before any signing
  // occurs. Still, `feeBumpHandler` imports the native signer at module-load
  // time, so we stub it to avoid requiring `fluid_signer.node` locally.
  const Module = require("module") as typeof import("module");
  const originalLoad = Module._load;
  Module._load = function (request: any, parent: any, isMain: any) {
    if (typeof request === "string" && request.endsWith("fluid_signer.node")) {
      return {
        signPayload: async () => Buffer.alloc(64),
        signPayloadFromVault: async () => Buffer.alloc(64),
      };
    }

    return originalLoad(request, parent, isMain);
  };

  let feeBumpHandler: any;
  try {
    // Import after stubbing the native module loader.
    ({ feeBumpHandler } = require("./feeBump"));
  } finally {
    // Keep the stub in place for the remainder of the test (imported handler
    // may retain references), but we still want a best-effort restore later.
  }

  const sourceKeypair = StellarSdk.Keypair.random();
  const feePayerKeypair = StellarSdk.Keypair.random();

  const networkPassphrase = StellarSdk.Networks.TESTNET;
  const baseFee = 100;

  const sourceAccount = new StellarSdk.Account(
    sourceKeypair.publicKey(),
    "1",
  );

  // Build a signed fee-bump transaction (this is what we attempt to fee-bump again).
  const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: String(baseFee),
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: sourceKeypair.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "10",
      }),
    )
    .setTimeout(0)
    .build();
  innerTransaction.sign(sourceKeypair);

  const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    feePayerKeypair.publicKey(),
    200,
    innerTransaction,
    networkPassphrase,
  );
  feeBumpTx.sign(feePayerKeypair);

  const feeBumpXdr = feeBumpTx.toXDR();

  const config: Config = {
    feePayerAccounts: [
      {
        publicKey: feePayerKeypair.publicKey(),
        keypair: feePayerKeypair,
        secretSource: {
          type: "env",
          secret: feePayerKeypair.secret(),
        },
      },
    ],
    baseFee,
    feeMultiplier: 2,
    networkPassphrase,
    allowedOrigins: ["*"],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 5,
  };

  const req: any = {
    body: {
      xdr: feeBumpXdr,
      submit: false,
    },
  };

  const res: any = {
    locals: {},
  };

  let nextErr: any;
  const next = (err: any) => {
    nextErr = err;
  };

  const warnCalls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
    // Keep the log visible so this test run produces the required audit log.
    originalWarn(...args);
  };

  try {
    await feeBumpHandler(req, res, next as any, config);
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(nextErr, "Expected feeBumpHandler to call next(err)");
  assert.strictEqual(nextErr.statusCode, 400);
  assert.strictEqual(
    nextErr.message,
    "Cannot fee-bump an already fee-bumped transaction",
  );

  assert.strictEqual(warnCalls.length, 1);
  assert.strictEqual(
    warnCalls[0][0],
    "Rejected fee-bump request: Cannot fee-bump an already fee-bumped transaction",
  );

  // Restore module loader to avoid impacting any other test files.
  Module._load = originalLoad;
}

async function main(): Promise<void> {
  await testRejectDoubleBumpedTransaction();
  console.log("✅ Double-bump rejection test passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

