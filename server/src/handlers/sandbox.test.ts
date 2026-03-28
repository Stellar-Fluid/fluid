/**
 * Sandbox handler unit tests
 * Run with: npx vitest --run src/handlers/sandbox.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../utils/db", () => ({
  default: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    sponsoredTransaction: {
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../utils/redis", () => ({
  invalidateApiKeyCache: vi.fn().mockResolvedValue(undefined),
  incrWithExpiry: vi.fn().mockResolvedValue({ count: 1, ttl: 60 }),
}));

vi.mock("../utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock global fetch for Friendbot calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ──────────────────────────────────────────────────────────────────

import prisma from "../utils/db";

function makeRes() {
  const res = {
    locals: {} as Record<string, any>,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  return res as unknown as Response;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function sandboxApiKeyConfig(overrides = {}) {
  return {
    key: "sbx_testkey123",
    tenantId: "tenant-abc",
    name: "Sandbox Key",
    tier: "free" as const,
    tierName: "Free" as const,
    tierId: "tier-free",
    txLimit: 10,
    rateLimit: 10,
    priceMonthly: 0,
    maxRequests: 10,
    windowMs: 60_000,
    dailyQuotaStroops: 500_000,
    isSandbox: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sandboxResetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("rejects non-sandbox API keys with 403", async () => {
    const { sandboxResetHandler } = await import("./sandbox");
    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig({ isSandbox: false });
    const next = makeNext();

    await sandboxResetHandler(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = (next as any).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("SANDBOX_ONLY");
  });

  it("returns 500 when apiKey context is missing", async () => {
    const { sandboxResetHandler } = await import("./sandbox");
    const req = {} as Request;
    const res = makeRes();
    // no res.locals.apiKey
    const next = makeNext();

    await sandboxResetHandler(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = (next as any).mock.calls[0][0];
    expect(err.statusCode).toBe(500);
  });

  it("deletes sponsored transactions and stamps resetAt", async () => {
    const { sandboxResetHandler } = await import("./sandbox");

    (prisma as any).sponsoredTransaction.deleteMany.mockResolvedValue({
      count: 7,
    });
    (prisma as any).apiKey.findUnique.mockResolvedValue({
      sandboxFeePayerSecret: null,
      id: "key-id-1",
    });
    (prisma as any).apiKey.update.mockResolvedValue({});

    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig();
    const next = makeNext();

    await sandboxResetHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(
      (prisma as any).sponsoredTransaction.deleteMany,
    ).toHaveBeenCalledWith({
      where: { tenantId: "tenant-abc" },
    });
    expect((prisma as any).apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "sbx_testkey123" },
        data: expect.objectContaining({ sandboxLastResetAt: expect.any(Date) }),
      }),
    );

    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.ok).toBe(true);
    expect(jsonArg.deletedTransactions).toBe(7);
    expect(jsonArg.tenantId).toBe("tenant-abc");
  });

  it("calls Friendbot when sandboxFeePayerSecret is set", async () => {
    const { sandboxResetHandler } = await import("./sandbox");

    // Use a real Stellar keypair secret for the test
    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.random();

    (prisma as any).sponsoredTransaction.deleteMany.mockResolvedValue({
      count: 0,
    });
    (prisma as any).apiKey.findUnique.mockResolvedValue({
      sandboxFeePayerSecret: kp.secret(),
      id: "key-id-2",
    });
    (prisma as any).apiKey.update.mockResolvedValue({});
    mockFetch.mockResolvedValue({ ok: true });

    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig();
    const next = makeNext();

    await sandboxResetHandler(req, res, next);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/friendbot?addr="),
      expect.objectContaining({ method: "GET" }),
    );

    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.funded).toBe(true);
    expect(jsonArg.sandboxPublicKey).toBe(kp.publicKey());
  });

  it("sets funded=false when Friendbot returns non-OK", async () => {
    const { sandboxResetHandler } = await import("./sandbox");

    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.random();

    (prisma as any).sponsoredTransaction.deleteMany.mockResolvedValue({
      count: 0,
    });
    (prisma as any).apiKey.findUnique.mockResolvedValue({
      sandboxFeePayerSecret: kp.secret(),
      id: "key-id-3",
    });
    (prisma as any).apiKey.update.mockResolvedValue({});
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig();
    const next = makeNext();

    await sandboxResetHandler(req, res, next);

    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.funded).toBe(false);
  });
});

describe("sandboxStatusHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-sandbox keys with 403", async () => {
    const { sandboxStatusHandler } = await import("./sandbox");
    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig({ isSandbox: false });
    const next = makeNext();

    await sandboxStatusHandler(req, res, next);

    const err = (next as any).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  it("returns sandbox metadata", async () => {
    const { sandboxStatusHandler } = await import("./sandbox");

    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.random();

    (prisma as any).apiKey.findUnique.mockResolvedValue({
      sandboxLastResetAt: new Date("2026-03-01T00:00:00Z"),
      sandboxFeePayerSecret: kp.secret(),
      createdAt: new Date(),
    });
    (prisma as any).sponsoredTransaction.count.mockResolvedValue(3);

    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig();
    const next = makeNext();

    await sandboxStatusHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.isSandbox).toBe(true);
    expect(jsonArg.tenantId).toBe("tenant-abc");
    expect(jsonArg.sandboxPublicKey).toBe(kp.publicKey());
    expect(jsonArg.transactionsSinceReset).toBe(3);
  });
});

describe("createSandboxApiKeyHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
    process.env.FLUID_ADMIN_TOKEN = "test-admin-token";
  });

  it("rejects missing admin token", async () => {
    const { createSandboxApiKeyHandler } = await import("./sandbox");
    const req = { header: () => undefined, body: {} } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await createSandboxApiKeyHandler(req, res, next);

    const err = (next as any).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it("rejects missing tenantId", async () => {
    const { createSandboxApiKeyHandler } = await import("./sandbox");
    const req = {
      header: (h: string) =>
        h === "x-admin-token" ? "test-admin-token" : undefined,
      body: {},
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await createSandboxApiKeyHandler(req, res, next);

    const err = (next as any).mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  it("creates a sandbox key and returns it", async () => {
    const { createSandboxApiKeyHandler } = await import("./sandbox");

    (prisma as any).apiKey.create.mockResolvedValue({
      id: "new-key-id",
      key: "sbx_abc123",
      prefix: "sbx_abc1",
    });

    const req = {
      header: (h: string) =>
        h === "x-admin-token" ? "test-admin-token" : undefined,
      body: { tenantId: "tenant-xyz", name: "My Sandbox" },
    } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await createSandboxApiKeyHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.isSandbox).toBe(true);
    expect(typeof jsonArg.sandboxPublicKey).toBe("string");
    expect(jsonArg.sandboxPublicKey).toHaveLength(56); // Stellar public key length
  });
});

describe("sandboxRateLimit middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes through non-sandbox keys unchanged", async () => {
    const { sandboxRateLimit } = await import("../middleware/sandboxGuard");
    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig({ isSandbox: false });
    const next = makeNext();

    await sandboxRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows sandbox key within rate limit", async () => {
    const { incrWithExpiry } = await import("../utils/redis");
    (incrWithExpiry as any).mockResolvedValue({ count: 5, ttl: 55 });

    const { sandboxRateLimit } = await import("../middleware/sandboxGuard");
    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig();
    const next = makeNext();

    await sandboxRateLimit(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks sandbox key over rate limit with 429", async () => {
    const { incrWithExpiry } = await import("../utils/redis");
    (incrWithExpiry as any).mockResolvedValue({ count: 999, ttl: 30 });

    const { sandboxRateLimit } = await import("../middleware/sandboxGuard");
    const req = {} as Request;
    const res = makeRes();
    res.locals.apiKey = sandboxApiKeyConfig();
    const next = makeNext();

    await sandboxRateLimit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    const jsonArg = (res.json as any).mock.calls[0][0];
    expect(jsonArg.code).toBe("SANDBOX_RATE_LIMITED");
  });
});

describe("autoResetStaleSandboxKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it("resets stale keys and returns count", async () => {
    const { Keypair } = await import("@stellar/stellar-sdk");
    const kp = Keypair.random();

    (prisma as any).apiKey.findMany = vi.fn().mockResolvedValue([
      { key: "sbx_stale1", tenantId: "t1", sandboxFeePayerSecret: kp.secret() },
      { key: "sbx_stale2", tenantId: "t2", sandboxFeePayerSecret: null },
    ]);
    (prisma as any).sponsoredTransaction.deleteMany.mockResolvedValue({
      count: 5,
    });
    (prisma as any).apiKey.update.mockResolvedValue({});

    const { autoResetStaleSandboxKeys } = await import("./sandbox");
    const count = await autoResetStaleSandboxKeys();

    expect(count).toBe(2);
    expect(
      (prisma as any).sponsoredTransaction.deleteMany,
    ).toHaveBeenCalledTimes(2);
    expect((prisma as any).apiKey.update).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when no stale keys exist", async () => {
    (prisma as any).apiKey.findMany = vi.fn().mockResolvedValue([]);

    const { autoResetStaleSandboxKeys } = await import("./sandbox");
    const count = await autoResetStaleSandboxKeys();

    expect(count).toBe(0);
  });
});
