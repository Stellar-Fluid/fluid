import StellarSdk from "@stellar/stellar-sdk";
import { SignerPool, SignerSelectionStrategy } from "./signing";

export type HorizonSelectionStrategy = "priority" | "round_robin";

export interface FeePayerAccount {
  publicKey: string;
  keypair: ReturnType<typeof StellarSdk.Keypair.fromSecret>;
  secretSource: { type: "env"; secret: string };
}

export interface VaultConfig {
  addr: string;
  appRole?: {
    roleId: string;
    secretId: string;
  };
  kvMount: string;
  kvVersion: number;
  secretField: string;
  token?: string;
}

export interface Config {
  allowedOrigins: string[];
  baseFee: number;
  feeMultiplier: number;
  feePayerAccounts: FeePayerAccount[];
  horizonSelectionStrategy: HorizonSelectionStrategy;
  horizonUrl?: string;
  horizonUrls: string[];
  networkPassphrase: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  signerPool: SignerPool;
  stellarRpcUrl?: string;
  vaultConfig?: VaultConfig;
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
  const secrets = parseCommaSeparatedList(process.env.FLUID_FEE_PAYER_SECRET);
  if (secrets.length === 0) {
    throw new Error("FLUID_FEE_PAYER_SECRET must contain at least one secret");
  }

  const feePayerAccounts: FeePayerAccount[] = secrets.map((secret) => {
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    return {
      publicKey: keypair.publicKey(),
      keypair,
      secretSource: { type: "env", secret },
    };
  });

  const signerSelectionStrategy =
    process.env.FLUID_SIGNER_SELECTION === "round_robin"
      ? "round_robin"
      : "least_used";

  const signerPool = SignerPool.fromSecrets(secrets, {
    selectionStrategy: signerSelectionStrategy as SignerSelectionStrategy,
  });

  const configuredHorizonUrls = parseCommaSeparatedList(process.env.STELLAR_HORIZON_URLS);
  const legacyHorizonUrl = process.env.STELLAR_HORIZON_URL?.trim();
  const horizonUrls =
    configuredHorizonUrls.length > 0
      ? configuredHorizonUrls
      : legacyHorizonUrl
      ? [legacyHorizonUrl]
      : [];

  return {
    allowedOrigins: parseCommaSeparatedList(process.env.FLUID_ALLOWED_ORIGINS),
    baseFee: parseInt(process.env.FLUID_BASE_FEE || "100", 10),
    feeMultiplier: parseFloat(process.env.FLUID_FEE_MULTIPLIER || "2.0"),
    feePayerAccounts,
    horizonSelectionStrategy:
      process.env.FLUID_HORIZON_SELECTION === "round_robin"
        ? "round_robin"
        : "priority",
    horizonUrl: horizonUrls[0],
    horizonUrls,
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      "Test SDF Network ; September 2015",
    rateLimitMax: parseInt(process.env.FLUID_RATE_LIMIT_MAX || "5", 10),
    rateLimitWindowMs: parseInt(process.env.FLUID_RATE_LIMIT_WINDOW_MS || "60000", 10),
    signerPool,
    stellarRpcUrl: process.env.STELLAR_RPC_URL,
  };
}

let rrIndex = 0;

export function pickFeePayerAccount(config: Config): FeePayerAccount {
  const accounts = config.feePayerAccounts;
  const account = accounts[rrIndex % accounts.length];
  rrIndex = (rrIndex + 1) % accounts.length;
  return account;
}
