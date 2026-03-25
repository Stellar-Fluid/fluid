use ed25519_dalek::{ Signer, SigningKey };
use napi::bindgen_prelude::Buffer;
use napi::{ Error, Result };
use napi_derive::napi;
use serde_json::Value;
use stellar_strkey::Strkey;
use vaultrs::client::{VaultClient, VaultClientSettingsBuilder};
use vaultrs::{kv1, kv2};
use vaultrs_login::engines::approle::AppRoleLogin;
use vaultrs_login::LoginClient;
use zeroize::Zeroizing;
use std::sync::Once;

static TOKIO_INIT: Once = Once::new();

fn initialize_optimized_tokio_runtime() {
    TOKIO_INIT.call_once(|| {
        let worker_threads = std::env
            ::var("FLUID_TOKIO_WORKER_THREADS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| {
                let num_cores = num_cpus::get();
                if cfg!(debug_assertions) {
                    num_cores.min(2)
                } else {
                    num_cores
                }
            });

        let max_blocking_threads = std::env
            ::var("FLUID_TOKIO_MAX_BLOCKING_THREADS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| worker_threads * 4);

        let thread_stack_size = std::env
            ::var("FLUID_TOKIO_STACK_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(2 * 1024 * 1024); // 2MB default

        let rt = tokio::runtime::Builder
            ::new_multi_thread()
            .worker_threads(worker_threads)
            .max_blocking_threads(max_blocking_threads)
            .thread_stack_size(thread_stack_size)
            .thread_name_fn(|| {
                static ATOMIC_ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(
                    0
                );
                let id = ATOMIC_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                format!("fluid-signer-{}", id)
            })
            .on_thread_start(|| {
                #[cfg(target_os = "linux")]
                {
                    if let Ok(cpu_id) = std::env::var("FLUID_TOKIO_CPU_PINNING") {
                        if let Ok(core_id) = cpu_id.parse::<usize>() {
                            if
                                let Err(e) = core_affinity::set_for_current(core_affinity::CoreId {
                                    id: core_id,
                                })
                            {
                                eprintln!("Failed to set CPU affinity: {}", e);
                            }
                        }
                    }
                }
                eprintln!("Tokio worker thread started");
            })
            .on_thread_stop(|| {
                eprintln!("Tokio worker thread stopped");
            })
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime");

        tokio::spawn(async move {
            eprintln!(
                "Optimized Tokio runtime initialized with {} worker threads, max blocking: {}, stack: {}MB",
                worker_threads,
                max_blocking_threads,
                thread_stack_size / (1024 * 1024)
            );
        });

        std::mem::forget(rt);
    });
}

fn map_join_error(err: tokio::task::JoinError) -> Error {
    Error::from_reason(format!("signing task failed: {err}"))
}

fn decode_secret(secret: &str) -> Result<[u8; 32]> {
    match Strkey::from_string(secret) {
        Ok(Strkey::PrivateKeyEd25519(key)) => Ok(key.0),
        Ok(_) => Err(Error::from_reason("expected a Stellar ed25519 private key".to_string())),
        Err(err) => Err(Error::from_reason(format!("invalid Stellar secret: {err}"))),
    }
}

async fn fetch_kv_secret(
    client: &VaultClient,
    kv_mount: &str,
    kv_version: u8,
    secret_path: &str,
    secret_field: &str,
) -> Result<String> {
    let kv_mount = kv_mount.trim_matches('/');
    let secret_path = secret_path.trim_matches('/');

    // Log the lookup location, but never log the secret itself.
    println!(
        "[vault] fetching signing key | kv_version={} | mount={} | path={} | field={}",
        kv_version, kv_mount, secret_path, secret_field
    );

    let data: Value = match kv_version {
        1 => kv1::get::<Value>(client, kv_mount, secret_path)
            .await
            .map_err(|e| Error::from_reason(format!("vault kv1 read failed: {e}")))?,
        2 => kv2::read::<Value>(client, kv_mount, secret_path)
            .await
            .map_err(|e| Error::from_reason(format!("vault kv2 read failed: {e}")))?,
        _ => {
            return Err(Error::from_reason(format!(
                "unsupported KV version for vault: {kv_version} (expected 1 or 2)"
            )))
        }
    };

    let secret_value = data
        .get(secret_field)
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            Error::from_reason(format!(
                "vault secret fetch missing expected field '{secret_field}'"
            ))
        })?;

    Ok(secret_value.to_string())
}

#[napi]
pub async fn sign_payload(secret: String, payload: Buffer) -> Result<Buffer> {
    initialize_optimized_tokio_runtime();

    let secret = Zeroizing::new(secret);
    let payload_bytes = payload.to_vec();

    let signature = tokio::task
        ::spawn_blocking(move || {
            let secret_key = Zeroizing::new(decode_secret(&secret)?);
            let signing_key = SigningKey::from_bytes(&secret_key);
            let signature = signing_key.sign(payload_bytes.as_slice());
            Ok::<Vec<u8>, Error>(signature.to_bytes().to_vec())
        }).await
        .map_err(map_join_error)??;

    Ok(Buffer::from(signature))
}

#[napi]
pub async fn sign_payload_from_vault(
    vault_addr: String,
    vault_token: String,
    approle_role_id: String,
    approle_secret_id: String,
    kv_mount: String,
    kv_version: u8,
    secret_path: String,
    secret_field: String,
    payload: Buffer,
) -> Result<Buffer> {
    let vault_token = vault_token.trim();
    let approle_role_id = approle_role_id.trim();
    let approle_secret_id = approle_secret_id.trim();

    let mut settings = VaultClientSettingsBuilder::default();
    settings.address(vault_addr.as_str());
    if !vault_token.is_empty() {
        // Token auth path.
        // (Builder supports token; see vaultrs docs for VaultClientSettingsBuilder.)
        settings.token(vault_token);
    }

    let mut client = VaultClient::new(
        settings
            .build()
            .map_err(|e| Error::from_reason(format!("vault settings build failed: {e}")))?,
    )
    .map_err(|e| Error::from_reason(format!("vault client init failed: {e}")))?;

    // If token not provided, authenticate using AppRole.
    if vault_token.is_empty() {
        if approle_role_id.is_empty() || approle_secret_id.is_empty() {
            return Err(Error::from_reason(
                "vault auth missing: provide either VAULT_TOKEN or (VAULT_APPROLE_ROLE_ID + VAULT_APPROLE_SECRET_ID)".to_string(),
            ));
        }

        let login = AppRoleLogin {
            role_id: approle_role_id.to_string(),
            secret_id: approle_secret_id.to_string(),
        };

        client
            .login("approle", &login)
            .await
            .map_err(|e| Error::from_reason(format!("vault approle login failed: {e}")))?;
    }

    let secret = fetch_kv_secret(&client, &kv_mount, kv_version, &secret_path, &secret_field).await?;
    let secret = Zeroizing::new(secret);

    let payload_bytes = payload.to_vec();
    let signature = tokio::task::spawn_blocking(move || {
        let secret_key = Zeroizing::new(decode_secret(&secret)?);
        let signing_key = SigningKey::from_bytes(&secret_key);
        let signature = signing_key.sign(payload_bytes.as_slice());
        Ok::<Vec<u8>, Error>(signature.to_bytes().to_vec())
    })
    .await
    .map_err(map_join_error)??;

    Ok(Buffer::from(signature))
}
