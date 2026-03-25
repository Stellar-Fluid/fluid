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
}

const nativeModulePath = join(__dirname, "../../fluid_signer.node");

export const nativeSigner = require(nativeModulePath) as NativeSignerBinding;
