export const TEST_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const TEST_SECRET_KEY =
  "SDMOYUZMPBA5SDXYC7346UPSFC3LA2QSHWI67M7ZW6G2D55TJ2H3A4IE";
export const TEST_DESTINATION =
  "GBWO4BS24FQ26NT2ZRYUMQXQ6FYMMZCKRFTO5XDSHPCRZVT336UWOGTW";

export function buildUnsignedTransaction(StellarSdk) {
  const sourceKeypair = StellarSdk.Keypair.fromSecret(TEST_SECRET_KEY);
  const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "123456789");

  return new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: TEST_NETWORK_PASSPHRASE
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: TEST_DESTINATION,
        asset: StellarSdk.Asset.native(),
        amount: "1.2345678"
      })
    )
    .addMemo(StellarSdk.Memo.text("fluid-wasm"))
    .setTimeout(StellarSdk.TimeoutInfinite)
    .build();
}
