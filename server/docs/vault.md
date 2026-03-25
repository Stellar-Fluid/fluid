## HashiCorp Vault key management (fee payer)

Fluid’s fee payer **private keys should not live in `.env`** in production. Instead, the native Rust signer can fetch a fee payer secret from **HashiCorp Vault KV** at signing time.

This doc covers a simple local setup (Vault dev mode) and how to configure Fluid to fetch signing keys from Vault.

### Local Vault (dev mode) quickstart

Start Vault in dev mode (in a separate shell):

```bash
vault server -dev -dev-root-token-id="root"
```

In another shell, set Vault env vars:

```bash
export VAULT_ADDR="http://127.0.0.1:8200"
export VAULT_TOKEN="root"
```

Enable KV v2 at mount `secret/` (dev server often already has it; this is safe to re-run):

```bash
vault secrets enable -path=secret kv-v2 || true
```

Write a Stellar secret to a path (example path: `fluid/fee-payers/payer-1`):

```bash
vault kv put secret/fluid/fee-payers/payer-1 secret="SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

### Configure Fluid server to use Vault

You must provide:

- `VAULT_ADDR`
- **either** `VAULT_TOKEN` **or** `VAULT_APPROLE_ROLE_ID` + `VAULT_APPROLE_SECRET_ID`
- `FLUID_FEE_PAYER_VAULT_SECRET_PATHS` (comma-separated, relative to the KV mount)
- `FLUID_FEE_PAYER_PUBLIC_KEYS` (comma-separated, same count as secret paths)

Example `.env` (KV v2 on mount `secret`):

```dotenv
VAULT_ADDR=http://127.0.0.1:8200
VAULT_TOKEN=root

FLUID_VAULT_KV_MOUNT=secret
FLUID_VAULT_KV_VERSION=2
FLUID_FEE_PAYER_VAULT_SECRET_FIELD=secret

FLUID_FEE_PAYER_VAULT_SECRET_PATHS=fluid/fee-payers/payer-1
FLUID_FEE_PAYER_PUBLIC_KEYS=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

When Vault mode is enabled, Fluid will:

- Build fee-bump transactions using the configured public keys
- Fetch the corresponding private key from Vault **inside the Rust native signer** at signature time

### Development fallback (explicit)

For local development only, you can bypass Vault by setting `FLUID_FEE_PAYER_SECRET` (comma-separated secrets). **This fallback is only used if the env var is explicitly set.**

### Expected logs (required for review)

When Vault-backed signing is in use, the Rust signer logs a line similar to:

```
[vault] fetching signing key | kv_version=2 | mount=secret | path=fluid/fee-payers/payer-1 | field=secret
```

This confirms the server fetched signing material from a Vault path (the secret value is never logged).

### References

- `vaultrs` Rust client docs: `https://docs.rs/vaultrs/latest/vaultrs/`
- KV v2 API helpers: `https://docs.rs/vaultrs/latest/vaultrs/kv2/`
- AppRole login helpers (`vaultrs-login`): `https://docs.rs/vaultrs-login/latest/vaultrs_login/`

