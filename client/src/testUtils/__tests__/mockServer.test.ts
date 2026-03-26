import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { FluidClient } from "../../index";
import { createFluidMockServer } from "../mockServer";

const TEST_SERVER_URL = "http://localhost:3000";

const client = new FluidClient({
  serverUrl: TEST_SERVER_URL,
  networkPassphrase: "Test SDF Network ; September 2015",
});

const FAKE_XDR = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// ---- Success Case ----
describe("FluidClient with mock server", () => {
  describe("success response", () => {
    const server = createFluidMockServer({ response: "success" });
    beforeAll(() => server.listen());
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it("returns a valid fee-bump response", async () => {
      const result = await client.requestFeeBump(FAKE_XDR, false);
      expect(result.status).toBe("success");
      expect(result.xdr).toBeDefined();
      expect(result.hash).toBeDefined();
    });
  });

  // ---- 400 Bad Request ----
  describe("bad_request response", () => {
    const server = createFluidMockServer({ response: "bad_request" });
    beforeAll(() => server.listen());
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it("throws an error on 400 bad request", async () => {
      await expect(client.requestFeeBump(FAKE_XDR, false)).rejects.toThrow(
        "Fluid server error"
      );
    });
  });

  // ---- 500 Server Error ----
  describe("server_error response", () => {
    const server = createFluidMockServer({ response: "server_error" });
    beforeAll(() => server.listen());
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it("throws an error on 500 server error", async () => {
      await expect(client.requestFeeBump(FAKE_XDR, false)).rejects.toThrow(
        "Fluid server error"
      );
    });
  });

  // ---- 429 Rate Limit ----
  describe("rate_limit response", () => {
    const server = createFluidMockServer({ response: "rate_limit" });
    beforeAll(() => server.listen());
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it("throws an error on 429 rate limit", async () => {
      await expect(client.requestFeeBump(FAKE_XDR, false)).rejects.toThrow(
        "Fluid server error"
      );
    });
  });
});
