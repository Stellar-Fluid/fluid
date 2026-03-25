# Signing Benchmark Report

Generated: 2026-03-25T11:59:56.871Z
Iterations: 5000
Warmup iterations: 500

| Implementation | Avg (ms) | P50 (ms) | P95 (ms) | Ops/sec | Relative to Node |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node stellar-sdk | 0.0867 | 0.0751 | 0.1390 | 11528.72 | 1.00x |
| Rust ed25519-dalek | 0.1556 | 0.1501 | 0.1749 | 6426.12 | 0.56x |

Node min/max: 0.0648 ms / 4.0020 ms
Rust min/max: 0.1214 ms / 6.6888 ms

Methodology:
- Builds one unsigned fee-bump transaction per benchmark run.
- Signs the same transaction repeatedly after clearing signatures to isolate signing latency.
- Verifies parity first to ensure the Rust signer produces the same Ed25519 signature over the Stellar transaction hash as the current Node implementation.
