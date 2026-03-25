const assert = require("node:assert/strict");
const StellarSdk = require("@stellar/stellar-sdk");
const init = require("../pkg/node/fluid_server.js");

async function main() {
  const { buildUnsignedTransaction, TEST_NETWORK_PASSPHRASE, TEST_SECRET_KEY } = await import(
    "./fixtures.js"
  );
  const unsignedTransaction = buildUnsignedTransaction(StellarSdk);
  const unsignedXdr = unsignedTransaction.toXDR();

  const wasmResult = init.signTransactionXdr(
    unsignedXdr,
    TEST_SECRET_KEY,
    TEST_NETWORK_PASSPHRASE
  );

  const jsSignedTransaction = StellarSdk.TransactionBuilder.fromXDR(
    unsignedXdr,
    TEST_NETWORK_PASSPHRASE
  );
  jsSignedTransaction.sign(StellarSdk.Keypair.fromSecret(TEST_SECRET_KEY));

  assert.equal(wasmResult.signedXdr, jsSignedTransaction.toXDR());
  assert.equal(wasmResult.signatureCount, 1);

  console.log("WASM signing matches the JavaScript SDK");
  console.log(
    JSON.stringify(
      {
        signedXdr: wasmResult.signedXdr,
        signerPublicKey: wasmResult.signerPublicKey,
        transactionHashHex: wasmResult.transactionHashHex,
        signatureCount: wasmResult.signatureCount
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
