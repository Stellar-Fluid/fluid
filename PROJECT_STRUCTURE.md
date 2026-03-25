# Project Structure

```
fluid/
├── server/              # Fluid server (TypeScript/Node.js)
│   ├── src/
│   │   ├── index.ts     # Main server entry point
│   │   ├── config.ts    # Configuration management
│   │   └── handlers/
│   │       └── feeBump.ts  # Fee-bump request handler
│   ├── dist/            # Compiled JavaScript (generated)
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── client/              # Fluid client library (TypeScript)
│   ├── src/
│   │   └── index.ts     # Client SDK
│   ├── dist/            # Compiled JavaScript (generated)
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── fluid-server/        # Rust server and WASM transaction signer
│   ├── src/
│   │   ├── main.rs      # Axum health-check server entry point
│   │   └── lib.rs       # Stellar transaction signing library + WASM exports
│   ├── wasm-demo/       # Node/browser validation harness for the WASM build
│   ├── Cargo.toml
│   └── Makefile
│
├── .gitignore          # Git ignore rules
├── README.md           # Main project documentation
└── PROJECT_STRUCTURE.md # This file
```

## Who Submits the Final Transaction?

**By default**: The **client** submits the fee-bump transaction after receiving it from the server.

**Optional**: Set `submit: true` in the request to have the **server** submit it directly (requires `STELLAR_HORIZON_URL` to be configured).

## Technology Stack

- **Server**: Node.js + TypeScript + Express
- **Rust/WASM**: Axum + wasm-bindgen + stellar-xdr
- **Client**: Node.js + TypeScript
- **Stellar SDK**: @stellar/stellar-sdk (JavaScript/TypeScript)
