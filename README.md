# Fluid - Stellar Fee Sponsorship Service

Fluid enables gasless Stellar transactions by abstracting network fees. **The core purpose is to allow applications to let users pay with the token they're spending (e.g., USDC) without the application needing to worry about gas abstraction or requiring users to hold XLM for fees.**

Users sign their transactions locally, and Fluid wraps them in fee-bump transactions to pay network fees in XLM on their behalf. Alongside the existing TypeScript services, the repo now includes a Rust `fluid-server` crate that exposes a WASM signing module for Stellar transaction envelopes.

## Purpose

Fluid solves the gas abstraction problem for Stellar applications. Instead of requiring users to:
- Hold XLM for transaction fees
- Understand fee mechanics
- Manage multiple assets (payment token + fee token)

Applications can integrate into any Fluid server that supports the fee token to let users pay with their preferred token (USDC etc ) while the Fluid server handles all XLM fee payments in the background. This removes friction and improves user experience.

## Quick Start

This project uses Node.js and TypeScript for easy setup and deployment.

### Prerequisites

- Node.js 18+ and npm
- A Stellar account with XLM for fee payments (testnet or mainnet)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd fluid
```

2. Install server dependencies:
```bash
cd server
npm install
```

3. Install client dependencies (optional):
```bash
cd ../client
npm install
```

4. Set up the admin dashboard (optional):
```bash
cd ../admin-dashboard
npm install
cp .env.local.example .env.local
# Configure authentication variables in .env.local
```

5. Configure the server:
```bash
cd ../server
cp .env.example .env
```

Edit `.env` and set your `FLUID_FEE_PAYER_SECRET`.

6. Build and run the server:
```bash
npm run build
npm start
```

The server will start on `http://localhost:3000`

7. Start the admin dashboard (optional):
```bash
cd ../admin-dashboard
npm run dev
```

The admin dashboard will be available at `http://localhost:3001`

## Admin Dashboard

Fluid includes a secure admin dashboard for monitoring and managing fee sponsorship operations:

### Features
- **Secure Authentication**: NextAuth.js with bcrypt password hashing
- **Protected Routes**: All admin areas require authentication
- **Session Management**: 8-hour JWT sessions with secure cookies
- **Modern UI**: Built with Next.js 14, TypeScript, and Tailwind CSS

### Access
- Login URL: `http://localhost:3001/login`
- Admin Dashboard: `http://localhost:3001/admin/dashboard`
- All `/admin/*` routes are protected and redirect to login if unauthenticated

### Authentication Setup
See `admin-dashboard/README.md` for detailed authentication configuration including environment variables and security setup.

## Project Structure

```
fluid/
├── server/              Fluid server (TypeScript/Node.js)
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   └── handlers/
│   │       └── feeBump.ts
│   ├── package.json
│   └── README.md
├── client/              Fluid client library (TypeScript)
│   ├── src/
│   │   └── index.ts
│   └── package.json
├── admin-dashboard/     Admin dashboard (Next.js)
│   ├── app/
│   │   ├── admin/
│   │   ├── login/
│   │   └── api/auth/
│   ├── components/
│   ├── auth.ts
│   ├── middleware.ts
│   └── README.md
└── README.md
```

## Rust WASM Signer

The `fluid-server/` crate exposes a `signTransactionXdr` WASM entrypoint plus helper exports for:

- deriving a Stellar public key from a secret seed
- hashing unsigned transaction envelopes with a network passphrase
- appending an ed25519 signature to a transaction envelope

The demo app in `fluid-server/wasm-demo/` builds a Stellar transaction in JavaScript, signs it through the Rust WASM module, and compares the result against the official Stellar JavaScript SDK.

### Rust/WASM Development

```bash
cd fluid-server
cargo test --lib
wasm-pack build --release --target web --out-dir pkg/web
wasm-pack build --release --target nodejs --out-dir pkg/node
cd wasm-demo
npm ci
npm run test:node
npm run test:browser
```

## Server Configuration

Create a `.env` file in the `server/` directory:

```bash
FLUID_FEE_PAYER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
FLUID_BASE_FEE=100
FLUID_FEE_MULTIPLIER=2.0
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
PORT=3000
FLUID_RATE_LIMIT_WINDOW_MS=60000
FLUID_RATE_LIMIT_MAX=5
```

## API Usage

### POST /fee-bump

Wraps a signed inner transaction in a fee-bump transaction.

Request:
```json
{
  "xdr": "<base64_encoded_signed_transaction_xdr>",
  "submit": false
}
```

Response:
```json
{
  "xdr": "<base64_encoded_fee_bump_transaction_xdr>",
  "status": "ready",
  "hash": null
}
```

## Client Usage

### Using the TypeScript Client

```typescript
import { FluidClient } from "./client/src";
import StellarSdk from "@stellar/stellar-sdk";

const client = new FluidClient({
  serverUrl: "http://localhost:3000",
  networkPassphrase: StellarSdk.Networks.TESTNET,
  horizonUrl: "https://horizon-testnet.stellar.org",
});

const transaction = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(/* your operation */)
  .build();

transaction.sign(keypair);

const result = await client.requestFeeBump(transaction.toXDR(), false);
const submitResult = await client.submitFeeBumpTransaction(result.xdr);
```

### Using JavaScript/Node.js

```javascript
const StellarSdk = require("@stellar/stellar-sdk");

const transaction = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(/* your operation */)
  .build();

transaction.sign(keypair);

const response = await fetch("http://localhost:3000/fee-bump", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    xdr: transaction.toXDR(),
    submit: false,
  }),
});

const { xdr: feeBumpXdr } = await response.json();

const feeBumpTx = StellarSdk.TransactionBuilder.fromXDR(
  feeBumpXdr,
  StellarSdk.Networks.TESTNET
);
const result = await server.submitTransaction(feeBumpTx);
```

## Architecture

- Stateless: Each request is independent
- Open Hosting: Anyone can run their own Fluid instance
- TypeScript: Type-safe code for both server and client
- Node.js: Easy to deploy and maintain
- Rust/WASM: Optional signing pipeline for browser or Node runtimes

## Security Notes

- Keep your `FLUID_FEE_PAYER_SECRET` secure
- Use HTTPS in production
- Consider rate limiting for public endpoints
- Monitor your fee payer account balance

## Development

### Server Development

```bash
cd server
npm run dev
npm run build
npm start
```

### Client Development

```bash
cd client
npm run dev
npm run build
```

## Testing

Test scripts are in the `initial-test/` directory:

```bash
cd initial-test
node test-fluid-server.js
```

## How It Works

1. User builds and signs a transaction locally
2. User sends the signed XDR to Fluid server
3. Fluid wraps it in a fee-bump transaction
4. Fluid signs the fee-bump with its own keypair
5. Fluid returns the fee-bump XDR (or submits it if `submit: true`)
6. Client submits the fee-bump transaction to Stellar network
   - By default: The client (your application) submits the final transaction
   - With `submit: true`: The server can submit it directly (requires `STELLAR_HORIZON_URL`)
7. Fee is paid by Fluid's fee payer account

Who submits the final transaction:
- Default behavior: The client submits the fee-bump transaction after receiving it from the server
- Optional: Set `submit: true` in the request to have the server submit it directly

## Use Cases

- DApps allowing users to pay with USDC/EURT/etc. without holding XLM
- Payment processors covering fees for better UX
- Removing fee barriers for end users
- Batch transaction processing

## License

ISC

## Contributing

Contributions welcome. This is an MVP with room for improvement:
- Dynamic fee calculation
- Multi-signer support
- Rate limiting
- Monitoring dashboard
- Multiple fee assets
