# Tokio Runtime Performance Report

Generated: 2026-03-25T10:43:11.671Z
System: 10 CPU cores

## Results Summary

| Configuration | Worker Threads | Max Blocking | Stack (MB) | RPS | Success Rate | Avg Latency (ms) |
|---------------|----------------|--------------|-----------|-----|--------------|------------------|
| baseline_default | 1 | 4 | 2 | 7829.64 | 100.00% | 0.13 |
| optimized_num_cores | 10 | 40 | 2 | 9630.02 | 100.00% | 0.10 |
| high_concurrency | 20 | 80 | 4 | 18110.09 | 100.00% | 0.06 |
| large_stack | 10 | 40 | 8 | 11961.04 | 100.00% | 0.08 |
| max_performance | 40 | 160 | 4 | 17912.76 | 100.00% | 0.06 |

## 🏆 Best Performance

**high_concurrency** achieved **18110.09 RPS**

- Worker threads: 20
- Max blocking threads: 80
- Stack size: 4MB
- Average latency: 0.06ms
- Success rate: 100.00%

## Target Achievement

✅ **SUCCESS**: Achieved 18110.09 RPS (target: 1000 RPS)

## Detailed Results

### baseline_default

- **Total requests**: 234891
- **Duration**: 30.00s
- **Requests per second**: 7829.64
- **Success rate**: 100.00%
- **Average latency**: 0.13ms

### optimized_num_cores

- **Total requests**: 288901
- **Duration**: 30.00s
- **Requests per second**: 9630.02
- **Success rate**: 100.00%
- **Average latency**: 0.10ms

### high_concurrency

- **Total requests**: 543304
- **Duration**: 30.00s
- **Requests per second**: 18110.09
- **Success rate**: 100.00%
- **Average latency**: 0.06ms

### large_stack

- **Total requests**: 358832
- **Duration**: 30.00s
- **Requests per second**: 11961.04
- **Success rate**: 100.00%
- **Average latency**: 0.08ms

### max_performance

- **Total requests**: 537383
- **Duration**: 30.00s
- **Requests per second**: 17912.76
- **Success rate**: 100.00%
- **Average latency**: 0.06ms

