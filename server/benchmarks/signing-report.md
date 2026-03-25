# Signing Benchmark Report

Generated: 2026-03-25T14:11:24.546Z
Iterations: 5000
Warmup iterations: 500

| Implementation | Avg (ms) | P50 (ms) | P95 (ms) | Ops/sec | Relative to Node |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node stellar-sdk | 0.0880 | 0.0750 | 0.1465 | 11357.49 | 1.00x |
| Rust ed25519-dalek | 0.1667 | 0.1515 | 0.1872 | 5999.96 | 0.53x |

Node min/max: 0.0646 ms / 4.0772 ms
Rust min/max: 0.1211 ms / 6.9515 ms

Methodology:
- Builds one unsigned fee-bump transaction per benchmark run.
- Signs the same transaction repeatedly after clearing signatures to isolate signing latency.
- Verifies parity first to ensure the Rust signer produces the same Ed25519 signature over the Stellar transaction hash as the current Node implementation.
