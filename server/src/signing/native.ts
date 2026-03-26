import StellarSdk from "@stellar/stellar-sdk";

interface NativeSignerBinding {
  signPayload(secret: string, payload: Buffer): Promise<Buffer>;
  signPayloadFromVault(
    vaultAddr: string,
    vaultToken: string,
    approleRoleId: string,
    approleSecretId: string,
    kvMount: string,
    kvVersion: number,
    secretPath: string,
    secretField: string,
    payload: Buffer
  ): Promise<Buffer>;
  preflightSoroban(rpcUrl: string, transactionXdr: string): Promise<string>;
}

// 🛡️ Bypassing the .node binary file for standard Node.js environments
export const nativeSigner: NativeSignerBinding = {
  async signPayload(secret: string, payload: Buffer): Promise<Buffer> {
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    // Standard ed25519 signing using the Stellar SDK
    const signature = keypair.sign(payload);
    return Buffer.from(signature);
  },

  async signPayloadFromVault(): Promise<Buffer> {
    throw new Error("Vault signing is disabled in this local environment.");
  },

  async preflightSoroban(): Promise<string> {
    throw new Error("Soroban preflight is disabled in this local environment.");
  }
};