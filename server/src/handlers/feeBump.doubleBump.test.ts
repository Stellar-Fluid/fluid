import assert from "node:assert";
import StellarSdk from "@stellar/stellar-sdk";
import type { Config } from "../config";
import { SignerPool } from "../signing";

async function testRejectDoubleBumpedTransaction(): Promise<void> {
  const Module = require("module") as typeof import("module");
  const moduleAny = Module as any;
  const originalLoad = moduleAny._load;

  moduleAny._load = function (request: any, parent: any, isMain: any) {
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
    ({ feeBumpHandler } = require("./feeBump"));

    const sourceKeypair = StellarSdk.Keypair.random();
    const feePayerKeypair = StellarSdk.Keypair.random();
    const networkPassphrase = StellarSdk.Networks.TESTNET;
    const baseFee = 100;

    const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "1");

    const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: String(baseFee),
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: sourceKeypair.publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(0)
      .build();
    innerTransaction.sign(sourceKeypair);

    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feePayerKeypair.publicKey(),
      200,
      innerTransaction,
      networkPassphrase
    );
    feeBumpTx.sign(feePayerKeypair);

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
      allowedOrigins: ["*"],
      baseFee,
      feeMultiplier: 2,
      horizonSelectionStrategy: "priority",
      horizonUrls: [],
      networkPassphrase,
      rateLimitMax: 5,
      rateLimitWindowMs: 60_000,
      signerPool: SignerPool.fromSecrets([feePayerKeypair.secret()]),
    };

    const req: any = {
      body: {
        xdr: feeBumpTx.toXDR(),
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
      originalWarn(...args);
    };

    try {
      await feeBumpHandler(req, res, config, next);
    } finally {
      console.warn = originalWarn;
    }

    assert.ok(nextErr, "Expected feeBumpHandler to call next(err)");
    assert.strictEqual(nextErr.statusCode, 400);
    assert.strictEqual(
      nextErr.message,
      "Cannot fee-bump an already fee-bumped transaction"
    );

    assert.strictEqual(warnCalls.length, 1);
    assert.strictEqual(
      warnCalls[0][0],
      "Rejected fee-bump request: Cannot fee-bump an already fee-bumped transaction"
    );
  } finally {
    moduleAny._load = originalLoad;
  }
}

async function main(): Promise<void> {
  await testRejectDoubleBumpedTransaction();
  console.log("Double-bump rejection test passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
