use criterion::{black_box, criterion_group, criterion_main, Criterion};
use napi::bindgen_prelude::Buffer;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;

use fluid_signer::sign_payload;

fn create_optimized_runtime(worker_threads: usize, max_blocking: usize, stack_size: usize) -> Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .max_blocking_threads(max_blocking)
        .thread_stack_size(stack_size)
        .thread_name_fn(|| {
            static ATOMIC_ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let id = ATOMIC_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            format!("benchmark-worker-{}", id)
        })
        .enable_all()
        .build()
        .unwrap()
}

fn bench_signing_default(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    
    c.bench_function("signing_default_runtime", |b| {
        b.iter(|| {
            rt.block_on(async {
                let secret = "SCFPATHARWYMJJXGSBWECWBZRWHDZTQFEANMELJCCMRQG4JNYMFPKUZ2V";
                let payload = Buffer::from(vec![1u8; 100]);
                black_box(sign_payload(secret.to_string(), payload).await.unwrap());
            })
        })
    });
}

fn bench_signing_optimized(c: &mut Criterion) {
    let num_cores = num_cpus::get();
    let rt = create_optimized_runtime(num_cores, num_cores * 4, 2 * 1024 * 1024);
    
    c.bench_function("signing_optimized_runtime", |b| {
        b.iter(|| {
            rt.block_on(async {
                let secret = "SCFPATHARWYMJJXGSBWECWBZRWHDZTQFEANMELJCCMRQG4JNYMFPKUZ2V";
                let payload = Buffer::from(vec![1u8; 100]);
                black_box(sign_payload(secret.to_string(), payload).await.unwrap());
            })
        })
    });
}

fn bench_signing_high_concurrency(c: &mut Criterion) {
    let mut group = c.benchmark_group("high_concurrency_signing");
    
    // Test different thread configurations
    let configs = vec![
        (1, "single_thread"),
        (2, "dual_thread"),
        (num_cpus::get(), "num_cores"),
        (num_cpus::get() * 2, "double_cores"),
    ];
    
    for (threads, name) in configs {
        let rt = create_optimized_runtime(threads, threads * 4, 2 * 1024 * 1024);
        group.bench_function(name, |b| {
            b.iter(|| {
                rt.block_on(async {
                    let mut handles = vec![];
                    for _ in 0..100 {
                        let secret = "SCFPATHARWYMJJXGSBWECWBZRWHDZTQFEANMELJCCMRQG4JNYMFPKUZ2V".to_string();
                        let payload = Buffer::from(vec![1u8; 100]);
                        handles.push(tokio::spawn(sign_payload(secret, payload)));
                    }
                    
                    for handle in handles {
                        black_box(handle.await.unwrap());
                    }
                })
            })
        });
    }
    
    group.finish();
}

fn bench_different_stack_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("stack_size_comparison");
    
    let stack_sizes = vec![
        (512 * 1024, "512kb"),
        (1024 * 1024, "1mb"),
        (2 * 1024 * 1024, "2mb"),
        (4 * 1024 * 1024, "4mb"),
    ];
    
    for (stack_size, name) in stack_sizes {
        let rt = create_optimized_runtime(num_cpus::get(), num_cpus::get() * 4, stack_size);
        group.bench_function(name, |b| {
            b.iter(|| {
                rt.block_on(async {
                    let secret = "SCFPATHARWYMJJXGSBWECWBZRWHDZTQFEANMELJCCMRQG4JNYMFPKUZ2V";
                    let payload = Buffer::from(vec![1u8; 100]);
                    black_box(sign_payload(secret.to_string(), payload).await.unwrap());
                })
            })
        });
    }
    
    group.finish();
}

fn bench_thread_pinning(c: &mut Criterion) {
    let mut group = c.benchmark_group("cpu_affinity");
    
    #[cfg(target_os = "linux")]
    {
        // Test with CPU pinning
        let rt = create_optimized_runtime(num_cpus::get(), num_cpus::get() * 4, 2 * 1024 * 1024);
        group.bench_function("with_cpu_pinning", |b| {
            b.iter(|| {
                rt.block_on(async {
                    let secret = "SCFPATHARWYMJJXGSBWECWBZRWHDZTQFEANMELJCCMRQG4JNYMFPKUZ2V";
                    let payload = Buffer::from(vec![1u8; 100]);
                    black_box(sign_payload(secret.to_string(), payload).await.unwrap());
                })
            })
        });
    }
    
    group.finish();
}

criterion_group!(
    benches,
    bench_signing_default,
    bench_signing_optimized,
    bench_signing_high_concurrency,
    bench_different_stack_sizes,
    bench_thread_pinning
);
criterion_main!(benches);
