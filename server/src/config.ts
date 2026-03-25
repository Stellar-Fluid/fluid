import StellarSdk from "@stellar/stellar-sdk";

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
  baseFee: number;
  feeMultiplier: number;
  networkPassphrase: string;
  horizonUrl?: string;
  maxXdrSize: number;
  maxOperations: number;
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  vault?: VaultConfig;
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

  // Support comma-separated list of secrets
  const secrets = rawSecrets
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

  const baseFee = parseInt(process.env.FLUID_BASE_FEE || "100", 10);
  const feeMultiplier = parseFloat(process.env.FLUID_FEE_MULTIPLIER || "2.0");
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015";
  const horizonUrl = process.env.STELLAR_HORIZON_URL;

  // Safety limits to prevent DoS attacks
  const maxXdrSize = parseInt(process.env.FLUID_MAX_XDR_SIZE || "10240", 10); // Default: 10KB
  const maxOperations = parseInt(process.env.FLUID_MAX_OPERATIONS || "100", 10); // Default: 100 operations

  return {
    feePayerAccounts,
    baseFee,
    feeMultiplier,
    networkPassphrase,
    horizonUrl,
    maxXdrSize,
    maxOperations,
    allowedOrigins,
    rateLimitWindowMs,
    rateLimitMax,
  };
}

// Round-robin counter (module-level, safe for single-threaded Node.js event loop)
let rrIndex = 0;

/**
 * Pick the next fee payer account using Round Robin strategy.
 */
export function pickFeePayerAccount(config: Config): FeePayerAccount {
  const accounts = config.feePayerAccounts;
  const account = accounts[rrIndex % accounts.length];
  rrIndex = (rrIndex + 1) % accounts.length;
  return account;
}
