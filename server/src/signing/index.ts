import StellarSdk from "@stellar/stellar-sdk";
import { nativeSigner } from "./native";
export { SignerPool } from "./signerPool";
export type {
  PoolAccountSnapshot,
  PooledSignerAccount,
  SignerLease,
  SignerPoolOptions,
  SignerSelectionStrategy,
} from "./signerPool";

interface SignableTransaction {
  addDecoratedSignature(signature: unknown): void;
  hash(): Buffer;
}

interface SignerMetadata {
  hint: Buffer;
}

const signerMetadataCache = new Map<string, SignerMetadata>();

function getSignerMetadata(secret: string): SignerMetadata {
  const cached = signerMetadataCache.get(secret);
  if (cached) {
    return cached;
  }

  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const metadata = {
    hint: Buffer.from(keypair.signatureHint()),
  };

  signerMetadataCache.set(secret, metadata);
  return metadata;
}

export async function signTransaction(
  tx: SignableTransaction,
  secret: string
): Promise<void> {
  const { hint } = getSignerMetadata(secret);
  const signature = await nativeSigner.signPayload(secret, tx.hash());

  tx.addDecoratedSignature(
    new StellarSdk.xdr.DecoratedSignature({
      hint,
      signature,
      })
  );
}

export function signTransactionWithNode(
  tx: { sign(...keypairs: unknown[]): void },
  secret: string
): void {
  tx.sign(StellarSdk.Keypair.fromSecret(secret));
}