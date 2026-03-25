import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock Prisma before importing WebhookService
vi.mock("../utils/db", () => ({
  default: {
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

import { WebhookService } from "./webhook";
import prisma from "../utils/db";

const mockPrisma = prisma as any;

describe("WebhookService", () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService();
    vi.clearAllMocks();
    // Reset global fetch mock
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("dispatch — tenant not found", () => {
    it("logs a warning and skips dispatch when tenant is not found", async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await service.dispatch("unknown-tenant", "hash-abc", "success");

      expect(fetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tenant not found")
      );
      warnSpy.mockRestore();
    });
  });

  describe("dispatch — webhookUrl is null", () => {
    it("skips HTTP call when tenant has no webhookUrl", async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: "tenant-1",
        webhookUrl: null,
      });

      await service.dispatch("tenant-1", "hash-abc", "success");

      expect(fetch).not.toHaveBeenCalled();
    });

    /**
     * Property 3: Dispatch is skipped when webhookUrl is null
     * Validates: Requirements 3.3
     * Feature: tenant-webhooks, Property 3: Dispatch is skipped when webhookUrl is null
     *
     * For any (hash, status) pair where the tenant has webhookUrl = null,
     * dispatch should make zero outbound HTTP requests.
     */
    it("makes zero HTTP calls for any (hash, status) when webhookUrl is null", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          fc.constantFrom("success" as const, "failed" as const),
          async (hash, status) => {
            const mockFetch = vi.fn();
            vi.stubGlobal("fetch", mockFetch);

            mockPrisma.tenant.findUnique.mockResolvedValue({
              id: "tenant-null",
              webhookUrl: null,
            });

            await service.dispatch("tenant-null", hash, status);

            return mockFetch.mock.calls.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("dispatch — successful delivery", () => {
    it("POSTs JSON payload to webhookUrl", async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: "tenant-1",
        webhookUrl: "https://example.com/webhook",
      });
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      await service.dispatch("tenant-1", "hash-xyz", "success");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/webhook");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(options.body);
      expect(body).toEqual({ hash: "hash-xyz", status: "success" });
    });

    /**
     * Property 4: Webhook payload contains hash and status
     * Validates: Requirements 3.2
     * Feature: tenant-webhooks, Property 4: Webhook payload contains hash and status
     *
     * For any (hash, status) pair with a registered webhookUrl, the intercepted
     * POST body should equal { hash, status }.
     */
    it("dispatched payload contains exactly hash and status for any input", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          fc.constantFrom("success" as const, "failed" as const),
          async (hash, status) => {
            const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
            vi.stubGlobal("fetch", mockFetch);

            mockPrisma.tenant.findUnique.mockResolvedValue({
              id: "tenant-1",
              webhookUrl: "https://example.com/hook",
            });

            await service.dispatch("tenant-1", hash, status);

            if (mockFetch.mock.calls.length !== 1) return false;
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            return body.hash === hash && body.status === status && Object.keys(body).length === 2;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("dispatch — error handling", () => {
    it("logs error and does not throw on non-2xx response", async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: "tenant-1",
        webhookUrl: "https://example.com/webhook",
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(service.dispatch("tenant-1", "hash-err", "failed")).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("non-2xx"));
      errorSpy.mockRestore();
    });

    it("logs error and does not throw on network error", async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: "tenant-1",
        webhookUrl: "https://example.com/webhook",
      });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(service.dispatch("tenant-1", "hash-net", "success")).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Network error"));
      errorSpy.mockRestore();
    });

    /**
     * Property 5: LedgerMonitor continues after webhook failure
     * Validates: Requirements 3.4, 3.5
     * Feature: tenant-webhooks, Property 5: LedgerMonitor continues after webhook failure
     *
     * For any sequence of error conditions (non-2xx or network throws),
     * dispatch should never throw and always resolve.
     */
    it("never throws for any error condition", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          fc.constantFrom("success" as const, "failed" as const),
          fc.oneof(
            fc.integer({ min: 400, max: 599 }).map((code) => ({ ok: false, status: code })),
            fc.constant(null) // null signals network error
          ),
          async (hash, status, responseOrNull) => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            vi.spyOn(console, "warn").mockImplementation(() => {});

            if (responseOrNull === null) {
              vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
            } else {
              vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseOrNull));
            }

            mockPrisma.tenant.findUnique.mockResolvedValue({
              id: "tenant-1",
              webhookUrl: "https://example.com/hook",
            });

            // Should never throw
            await service.dispatch("tenant-1", hash, status);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
