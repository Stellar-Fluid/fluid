import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * Preset response types supported by the Fluid mock server.
 */
export type MockResponseType = "success" | "bad_request" | "server_error" | "rate_limit";

/**
 * Configuration for the Fluid mock server.
 */
export interface FluidMockServerConfig {
  /** The URL to intercept. Defaults to `http://localhost:3000`. */
  serverUrl?: string;
  /** The preset response type. Defaults to `"success"`. */
  response?: MockResponseType;
  /** Optional custom XDR to return in success responses. */
  customXdr?: string;
}

/**
 * Preset mock responses for different scenarios.
 */
const MOCK_RESPONSES: Record<MockResponseType, { status: number; body: object }> = {
  success: {
    status: 200,
    body: {
      xdr: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      status: "success",
      hash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc123",
    },
  },
  bad_request: {
    status: 400,
    body: { error: "Bad Request", message: "Invalid XDR format provided." },
  },
  server_error: {
    status: 500,
    body: { error: "Internal Server Error", message: "Fee-bump failed on server." },
  },
  rate_limit: {
    status: 429,
    body: { error: "Too Many Requests", message: "Rate limit exceeded. Try again later." },
  },
};

/**
 * Creates a lightweight mock server for testing FluidClient
 * without needing a real Fluid node.
 *
 * @param config - Configuration options for the mock server.
 * @returns A configured MSW server instance ready to use in tests.
 *
 * @example
 * ```ts
 * const server = createFluidMockServer({ response: "success" });
 * server.listen();
 * // run your tests...
 * server.close();
 * ```
 */
export function createFluidMockServer(config: FluidMockServerConfig = {}) {
  const {
    serverUrl = "http://localhost:3000",
    response = "success",
    customXdr,
  } = config;

  const preset = MOCK_RESPONSES[response];

  // Override XDR if custom one provided
  const responseBody =
    response === "success" && customXdr
      ? { ...preset.body, xdr: customXdr }
      : preset.body;

  const handler = http.post(`${serverUrl}/fee-bump`, () => {
    return HttpResponse.json(responseBody, { status: preset.status });
  });

  return setupServer(handler);
}
