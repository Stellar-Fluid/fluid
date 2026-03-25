import { join } from "path";

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

const nativeModulePath = join(__dirname, "../../fluid_signer.node");

function unavailableNativeSigner(reason: string): NativeSignerBinding {
  const fail = async (): Promise<never> => {
    throw new Error(`Native signer is unavailable: ${reason}`);
  };

  return {
    signPayload: fail,
    signPayloadFromVault: fail,
    preflightSoroban: fail,
  };
}

let loadedNativeSigner: NativeSignerBinding;
try {
  loadedNativeSigner = require(nativeModulePath) as NativeSignerBinding;
} catch (error: any) {
  loadedNativeSigner = unavailableNativeSigner(error?.message ?? "unknown load error");
}

export const nativeSigner = loadedNativeSigner;
