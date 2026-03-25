import StellarSdk from "@stellar/stellar-sdk";
import { SignerPool } from "./signing";

export type HorizonSelectionStrategy = "priority" | "round_robin";

export interface FeePayerAccount {
  publicKey: string;
  keypair: any;
  secretSource:
    | { type: "env"; secret: string }
    | { type: "vault"; secretPath: string };
}

export interface VaultConfig {
  addr: string;
  token?: string;
  appRole?: {
    roleId: string;
    secretId: string;
  };
  kvMount: string;
  kvVersion: 1 | 2;
  secretField: string;
}

export interface Config {
  feePayerAccounts: FeePayerAccount[];
  signerPool: SignerPool;
  baseFee: number;
  feeMultiplier: number;
  networkPassphrase: string;
  horizonUrl?: string;
  horizonUrls: string[];
  horizonSelectionStrategy: HorizonSelectionStrategy;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  allowedOrigins: string[];
}

function parseCommaSeparatedList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(): Config {
  const allowedOriginsRaw = process.env.FLUID_ALLOWED_ORIGINS;
  const allowedOrigins =
    allowedOriginsRaw
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? ["*"];

  const rateLimitWindowMs = parseInt(
    process.env.FLUID_RATE_LIMIT_WINDOW_MS || "60000",
    10
  );
  const rateLimitMax = parseInt(process.env.FLUID_RATE_LIMIT_MAX || "5", 10);

  const baseFee = parseInt(process.env.FLUID_BASE_FEE || "100", 10);
  const feeMultiplier = parseFloat(process.env.FLUID_FEE_MULTIPLIER || "2.0");
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015";
  const horizonUrl = process.env.STELLAR_HORIZON_URL;

  const vaultAddr = process.env.VAULT_ADDR;
  const vaultToken = process.env.VAULT_TOKEN;
  const vaultAppRoleRoleId = process.env.VAULT_APPROLE_ROLE_ID;
  const vaultAppRoleSecretId = process.env.VAULT_APPROLE_SECRET_ID;
  const vaultKvMount = process.env.FLUID_VAULT_KV_MOUNT || "secret";
  const vaultKvVersionRaw = process.env.FLUID_VAULT_KV_VERSION || "2";
  const vaultKvVersion = (vaultKvVersionRaw === "1" ? 1 : 2) as 1 | 2;
  const vaultSecretField = process.env.FLUID_FEE_PAYER_VAULT_SECRET_FIELD || "secret";

  const vaultConfigured =
    !!vaultAddr &&
    (!!vaultToken ||
      (!!vaultAppRoleRoleId && !!vaultAppRoleSecretId));

  const feePayerSecretsEnvRaw = process.env.FLUID_FEE_PAYER_SECRET;
  const feePayerSecretsEnv = feePayerSecretsEnvRaw
    ? feePayerSecretsEnvRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const vaultSecretPathsRaw = process.env.FLUID_FEE_PAYER_VAULT_SECRET_PATHS;
  const vaultSecretPaths = vaultSecretPathsRaw
    ? vaultSecretPathsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const vaultPublicKeysRaw = process.env.FLUID_FEE_PAYER_PUBLIC_KEYS;
  const vaultPublicKeys = vaultPublicKeysRaw
    ? vaultPublicKeysRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  if (vaultConfigured && vaultSecretPaths.length > 0 && vaultPublicKeys.length > 0) {
    if (vaultSecretPaths.length !== vaultPublicKeys.length) {
      throw new Error(
        "Vault mode requires FLUID_FEE_PAYER_VAULT_SECRET_PATHS and FLUID_FEE_PAYER_PUBLIC_KEYS to have the same number of entries"
      );
    }

    const vault: VaultConfig = {
      addr: vaultAddr!,
      token: vaultToken,
      appRole:
        vaultToken
          ? undefined
          : {
              roleId: vaultAppRoleRoleId!,
              secretId: vaultAppRoleSecretId!,
            },
      kvMount: vaultKvMount,
      kvVersion: vaultKvVersion,
      secretField: vaultSecretField,
    };

    const feePayerAccounts: FeePayerAccount[] = vaultPublicKeys.map(
      (publicKey, i) => {
        // We only need the public key to build the fee-bump transaction;
        // the Rust signer will fetch the private key from Vault at runtime.
        const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
        return {
          publicKey,
          keypair,
          secretSource: {
            type: "vault",
            secretPath: vaultSecretPaths[i],
          },
        };
      }
    );

    return {
      feePayerAccounts,
      baseFee,
      feeMultiplier,
      networkPassphrase,
      horizonUrl,
      allowedOrigins,
      rateLimitWindowMs,
      rateLimitMax,
      vault,
    };
  }

  const secrets = parseCommaSeparatedList(rawSecrets);
  if (secrets.length === 0) {
    throw new Error("FLUID_FEE_PAYER_SECRET must contain at least one secret");
  // Env fallback is only used when the secret env var is explicitly configured.
  // This is useful for local development; production should use Vault.
  if (feePayerSecretsEnv.length === 0) {
    throw new Error(
      "No fee payer secrets configured. Provide either Vault settings (VAULT_ADDR + token/approle + FLUID_FEE_PAYER_VAULT_SECRET_PATHS + FLUID_FEE_PAYER_PUBLIC_KEYS) or set FLUID_FEE_PAYER_SECRET for env-based development."
    );
  }

  const feePayerAccounts: FeePayerAccount[] = feePayerSecretsEnv.map((secret) => {
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    return {
      publicKey: keypair.publicKey(),
      keypair,
      secretSource: { type: "env", secret },
    };
  });
  const signerPool = new SignerPool(
    feePayerAccounts.map((account) => ({
      keypair: account.keypair,
      secret: account.secret,
    })),
    {
      selectionStrategy: "least_used",
    }
  );

  const baseFee = parseInt(process.env.FLUID_BASE_FEE || "100", 10);
  const feeMultiplier = parseFloat(process.env.FLUID_FEE_MULTIPLIER || "2.0");
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015";
  const configuredHorizonUrls = parseCommaSeparatedList(
    process.env.STELLAR_HORIZON_URLS
  );
  const legacyHorizonUrl = process.env.STELLAR_HORIZON_URL?.trim();
  const horizonUrls =
    configuredHorizonUrls.length > 0
      ? configuredHorizonUrls
      : legacyHorizonUrl
        ? [legacyHorizonUrl]
        : [];
  const horizonSelectionStrategy =
    process.env.FLUID_HORIZON_SELECTION === "round_robin"
      ? "round_robin"
      : "priority";
  const rateLimitWindowMs = parseInt(
    process.env.FLUID_RATE_LIMIT_WINDOW_MS || "60000",
    10
  );
  const rateLimitMax = parseInt(process.env.FLUID_RATE_LIMIT_MAX || "5", 10);
  const allowedOrigins = parseCommaSeparatedList(process.env.FLUID_ALLOWED_ORIGINS);

  // Safety limits to prevent DoS attacks
  const maxXdrSize = parseInt(process.env.FLUID_MAX_XDR_SIZE || "10240", 10); // Default: 10KB
  const maxOperations = parseInt(process.env.FLUID_MAX_OPERATIONS || "100", 10); // Default: 100 operations

  return {
    feePayerAccounts,
    signerPool,
    baseFee,
    feeMultiplier,
    networkPassphrase,
    horizonUrl: horizonUrls[0],
    horizonUrls,
    horizonSelectionStrategy,
    rateLimitWindowMs,
    rateLimitMax,
    allowedOrigins,
  };
}

let rrIndex = 0;

export function pickFeePayerAccount(config: Config): FeePayerAccount {
  const snapshot = config.signerPool.getSnapshot();
  const nextPublicKey = snapshot[rrIndex % snapshot.length]?.publicKey;
  rrIndex = (rrIndex + 1) % snapshot.length;
  const account = config.feePayerAccounts.find(
    (candidate) => candidate.publicKey === nextPublicKey
  );

  if (!account) {
    throw new Error("Failed to select fee payer account from signer pool");
  }

  return account;
}
