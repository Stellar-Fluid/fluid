import { fluidServerUrl, fluidAdminToken } from "./server-env";

export interface SandboxApiKey {
  id: string;
  key: string;
  prefix: string;
  tenantId: string;
  active: boolean;
  isSandbox: true;
  sandboxPublicKey: string | null;
  sandboxLastResetAt: string | null;
  createdAt: string;
}

export interface SandboxPageData {
  keys: SandboxApiKey[];
  sandboxHorizonUrl: string;
  sandboxRateLimitMax: number;
  source: "live" | "sample";
}

const SAMPLE_KEYS: SandboxApiKey[] = [
  {
    id: "sbx-sample-1",
    key: "sbx_...sample",
    prefix: "sbx_",
    tenantId: "sample-tenant",
    active: true,
    isSandbox: true,
    sandboxPublicKey:
      "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    sandboxLastResetAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export async function getSandboxPageData(): Promise<SandboxPageData> {
  try {
    const res = await fetch(`${fluidServerUrl}/admin/api-keys`, {
      headers: { "x-admin-token": fluidAdminToken },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    const allKeys: any[] = data.keys ?? [];

    const sandboxKeys: SandboxApiKey[] = allKeys
      .filter((k: any) => k.isSandbox)
      .map((k: any) => ({
        id: k.id,
        key: k.key,
        prefix: k.prefix,
        tenantId: k.tenantId,
        active: k.active,
        isSandbox: true,
        sandboxPublicKey: k.sandboxPublicKey ?? null,
        sandboxLastResetAt: k.sandboxLastResetAt ?? null,
        createdAt: k.createdAt,
      }));

    return {
      keys: sandboxKeys,
      sandboxHorizonUrl:
        process.env.NEXT_PUBLIC_SANDBOX_HORIZON_URL ?? "http://localhost:8000",
      sandboxRateLimitMax: Number(
        process.env.NEXT_PUBLIC_SANDBOX_RATE_LIMIT_MAX ?? "10",
      ),
      source: "live",
    };
  } catch {
    return {
      keys: SAMPLE_KEYS,
      sandboxHorizonUrl: "http://localhost:8000",
      sandboxRateLimitMax: 10,
      source: "sample",
    };
  }
}
