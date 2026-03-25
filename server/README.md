# Fluid Server

The Fluid server is a Node.js/TypeScript HTTP service that wraps signed Stellar transactions in fee-bump transactions. This allows applications to let users pay with the token they're spending (e.g., USDC) without requiring users to hold XLM for fees or the application to manage gas abstraction.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

Edit `.env` and set `FLUID_FEE_PAYER_SECRET`.

3. Build and run:
```bash
npm run build
npm start
```

Or for development:
```bash
npm run dev
```

## Configuration

See `.env.example` for all configuration options.

Required:
- Fee payer key material:
  - Development-only fallback: `FLUID_FEE_PAYER_SECRET` (comma-separated Stellar secrets)
  - Production (recommended): HashiCorp Vault KV (see `docs/vault.md`)

Optional:
- `FLUID_BASE_FEE` - Base fee in stroops (default: 100)
- `FLUID_FEE_MULTIPLIER` - Fee multiplier (default: 2.0)
- `STELLAR_NETWORK_PASSPHRASE` - Network passphrase (default: Testnet)
- `STELLAR_HORIZON_URL` - Legacy single Horizon URL
- `STELLAR_HORIZON_URLS` - Comma-separated Horizon URL list for failover
- `FLUID_HORIZON_SELECTION` - `priority` or `round_robin` node selection (default: `priority`)
- `PORT` - Server port (default: 3000)
- `FLUID_RATE_LIMIT_WINDOW_MS` - Rate limit window in milliseconds (default: 60000)
- `FLUID_RATE_LIMIT_MAX` - Max requests per window per IP (default: 5)
- `FLUID_ALLOWED_ORIGINS` - Comma-separated CORS allowlist; empty allows all origins

Mock API keys for local development:
- `fluid-free-demo-key` - Free tier, 2 requests per minute
- `fluid-pro-demo-key` - Pro tier, 5 requests per minute

## API Endpoints

### GET /health

Health check endpoint.

Response:
```json
{ "status": "ok" }
```

### POST /fee-bump

Wraps a signed transaction in a fee-bump transaction.

Request:
```json
{
  "xdr": "<base64_encoded_signed_transaction_xdr>",
  "submit": false
}
```

Headers:
```http
x-api-key: fluid-free-demo-key
```

Response:
```json
{
  "xdr": "<base64_encoded_fee_bump_transaction_xdr>",
  "status": "ready",
  "hash": null
}
```

If `submit: true` and Horizon URLs are configured, the server will submit the transaction and return the hash.

## Horizon Failover

The server now supports redundant Horizon submission and monitoring:

- Configure multiple nodes with `STELLAR_HORIZON_URLS`
- Use `FLUID_HORIZON_SELECTION=priority` to always prefer the first healthy node
- Use `FLUID_HORIZON_SELECTION=round_robin` to rotate the starting node each request
- Retry only retryable failures such as connection resets, timeouts, DNS failures, and 5xx/429 gateway responses
- Do not retry final submission errors such as invalid transaction payloads returned as 4xx responses

`GET /health` now includes `horizon_nodes` with each node's `Active` or `Inactive` status.

If a key exceeds its tier limit, the server returns `429 Too Many Requests` with a response that cites the API key limit.

## Rate Limit Verification

You can verify that rate limiting is applied per API key by sending three requests with the free key and then one with the pro key:

```bash
curl -X POST http://127.0.0.1:3000/fee-bump \
  -H "Content-Type: application/json" \
  -H "x-api-key: fluid-free-demo-key" \
  --data '{"xdr":"AAAA","submit":false}'
```

Repeat the same request three times within one minute. The first two requests will reach the handler, and the third returns `429 Too Many Requests`.

Then send the same request with the pro key:

```bash
curl -X POST http://127.0.0.1:3000/fee-bump \
  -H "Content-Type: application/json" \
  -H "x-api-key: fluid-pro-demo-key" \
  --data '{"xdr":"AAAA","submit":false}'
```

That request still goes through because the limit is tracked separately per API key.

## Architecture

- Express.js - HTTP server framework
- TypeScript - Type-safe code
- @stellar/stellar-sdk - Stellar SDK for transaction handling
- Rust + `ed25519-dalek` - Non-blocking fee-payer signature generation through a native N-API module

## Development

```bash
npm run dev
npm run build
npm start
npm run watch
npm run demo:horizon-failover
```

## Signing Benchmark

Run the benchmark locally with:

```bash
npm run benchmark:signing
```

That command builds the Rust signer, compares it against the current Node.js signing path, and writes the report to `server/benchmarks/signing-report.md`.
The GitHub Actions benchmark workflow also writes the same report back to the feature branch after a successful run.

## Signer Pool Test

Run the multi-account concurrency test with:

```bash
npm run test:signer-pool
```

That command builds the native signer, exercises the `SignerPool` across five concurrent accounts plus a 200-request load burst, and prints `POOL_TEST` log lines showing five distinct accounts signing five different transactions simultaneously.

## Project Structure

```
server/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── middleware/
│   │   ├── apiKeys.ts
│   │   └── rateLimit.ts
│   └── handlers/
│       └── feeBump.ts
├── dist/
├── package.json
├── tsconfig.json
└── README.md
```
