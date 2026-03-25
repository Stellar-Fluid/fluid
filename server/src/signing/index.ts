import StellarSdk from "@stellar/stellar-sdk";
import { VaultConfig } from "../config";
import { nativeSigner } from "./native";

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

function getSignerMetadataFromPublicKey(publicKey: string): SignerMetadata {
  // Cache by public key so we never have to keep secret material around.
  const cached = signerMetadataCache.get(publicKey);
  if (cached) {
    return cached;
  }

  const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
  const metadata = {
    hint: Buffer.from(keypair.signatureHint()),
  };

  signerMetadataCache.set(publicKey, metadata);
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

export async function signTransactionWithVault(
  tx: SignableTransaction,
  feePayerPublicKey: string,
  vaultConfig: VaultConfig,
  feePayerSecretPath: string
): Promise<void> {
  const { hint } = getSignerMetadataFromPublicKey(feePayerPublicKey);

  const signature = await nativeSigner.signPayloadFromVault(
    vaultConfig.addr,
    vaultConfig.token ?? "",
    vaultConfig.appRole?.roleId ?? "",
    vaultConfig.appRole?.secretId ?? "",
    vaultConfig.kvMount,
    vaultConfig.kvVersion,
    feePayerSecretPath,
    vaultConfig.secretField,
    tx.hash()
  );

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
