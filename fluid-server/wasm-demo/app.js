import init, { signTransactionXdr } from "../pkg/web/fluid_server.js";
import * as StellarSdkModule from "https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@11.3.0/+esm";
import {
  buildUnsignedTransaction,
  TEST_NETWORK_PASSPHRASE,
  TEST_SECRET_KEY
} from "./fixtures.js";

const statusElement = document.getElementById("status");
const outputElement = document.getElementById("console-output");
const StellarSdk = StellarSdkModule.default ?? StellarSdkModule;

function mirrorConsole(label, value) {
  const line = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  outputElement.textContent = `${outputElement.textContent}\n[${label}] ${line}`;
}

async function main() {
  await init();

  const unsignedTransaction = buildUnsignedTransaction(StellarSdk);
  const unsignedXdr = unsignedTransaction.toXDR();
  const wasmResult = signTransactionXdr(
    unsignedXdr,
    TEST_SECRET_KEY,
    TEST_NETWORK_PASSPHRASE
  );

  const jsSignedTransaction = StellarSdk.TransactionBuilder.fromXDR(
    unsignedXdr,
    TEST_NETWORK_PASSPHRASE
  );
  jsSignedTransaction.sign(StellarSdk.Keypair.fromSecret(TEST_SECRET_KEY));

  const matchesJsSdk = wasmResult.signedXdr === jsSignedTransaction.toXDR();
  if (!matchesJsSdk) {
    throw new Error("The WASM signer produced a different XDR than the JavaScript SDK");
  }

  const payload = {
    signerPublicKey: wasmResult.signerPublicKey,
    signatureCount: wasmResult.signatureCount,
    transactionHashHex: wasmResult.transactionHashHex,
    matchesJsSdk
  };

  console.log("WASM signing successful", payload);
  mirrorConsole("success", payload);
  statusElement.dataset.status = "success";
  statusElement.textContent = "WASM signing successful";
  document.body.dataset.status = "success";
}

main().catch((error) => {
  console.error(error);
  mirrorConsole("error", error instanceof Error ? error.message : String(error));
  statusElement.dataset.status = "error";
  statusElement.textContent = "WASM signing failed";
  document.body.dataset.status = "error";
});
