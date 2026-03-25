use ed25519_dalek::{ Signer, SigningKey };
use napi::bindgen_prelude::Buffer;
use napi::{ Error, Result };
use napi_derive::napi;
use stellar_strkey::Strkey;
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
