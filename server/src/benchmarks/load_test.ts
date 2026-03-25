import { performance } from "perf_hooks";

interface BenchmarkConfig {
  name: string;
  workerThreads: number;
  maxBlockingThreads: number;
  stackSize: number;
  duration: number;
  concurrency: number;
}

interface BenchmarkResult {
  config: BenchmarkConfig;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsPerSecond: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  cpuUsage: number;
  memoryUsage: number;
  errors: string[];
}

class LoadTester {
  public results: BenchmarkResult[] = [];
  private secretKey =
    "SCFPATHARWYMJJXGSBWECWBZRWHDZTQFEANMELJCCMRQG4JNYMFPKUZ2V";
  private testPayload = Buffer.alloc(100, 1);

  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    console.log(`\n🚀 Starting benchmark: ${config.name}`);
    console.log(`Configuration:`, config);

    // Initialize native signer
    await this.initializeNativeSigner();

    // Set environment variables for the Rust runtime
    process.env.FLUID_TOKIO_WORKER_THREADS = config.workerThreads.toString();
    process.env.FLUID_TOKIO_MAX_BLOCKING_THREADS =
      config.maxBlockingThreads.toString();
    process.env.FLUID_TOKIO_STACK_SIZE = config.stackSize.toString();

    const startTime = performance.now();
    const endTime = startTime + config.duration * 1000;

    const latencies: number[] = [];
    const errors: string[] = [];
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;

    // Get initial system metrics
    const initialMemory = process.memoryUsage();
    const startCpuUsage = process.cpuUsage();

    // Create concurrent workers
    const workers: Promise<void>[] = [];

    for (let i = 0; i < config.concurrency; i++) {
      workers.push(this.workerLoop(endTime, latencies, errors));
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    const totalTime = (performance.now() - startTime) / 1000;
    const finalCpuUsage = process.cpuUsage(startCpuUsage);
    const finalMemory = process.memoryUsage();

    // Calculate statistics
    totalRequests = successfulRequests + failedRequests;
    const requestsPerSecond = totalRequests / totalTime;

    latencies.sort((a, b) => a - b);
    const averageLatency =
      latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    const p95Latency = latencies[Math.floor(latencies.length * 0.95)];
    const p99Latency = latencies[Math.floor(latencies.length * 0.99)];

    const cpuUsage =
      ((finalCpuUsage.user + finalCpuUsage.system) / totalTime / 1000000) * 100;
    const memoryUsage = finalMemory.heapUsed / 1024 / 1024; // MB

    const result: BenchmarkResult = {
      config,
      totalRequests,
      successfulRequests,
      failedRequests,
      requestsPerSecond,
      averageLatency,
      p95Latency,
      p99Latency,
      cpuUsage,
      memoryUsage,
      errors,
    };

    console.log(`✅ Completed ${config.name}:`);
    console.log(`   Requests/sec: ${result.requestsPerSecond.toFixed(2)}`);
    console.log(
      `   Success rate: ${((successfulRequests / totalRequests) * 100).toFixed(2)}%`,
    );
    console.log(`   Avg latency: ${result.averageLatency.toFixed(2)}ms`);
    console.log(`   P95 latency: ${result.p95Latency.toFixed(2)}ms`);
    console.log(`   CPU usage: ${result.cpuUsage.toFixed(2)}%`);
    console.log(`   Memory usage: ${result.memoryUsage.toFixed(2)}MB`);

    this.results.push(result);
    return result;
  }

  private async workerLoop(
    endTime: number,
    latencies: number[],
    errors: string[],
  ): Promise<void> {
    while (performance.now() < endTime) {
      try {
        const startTime = performance.now();

        await nativeSigner.signPayload(this.secretKey, this.testPayload);

        const latency = performance.now() - startTime;
        latencies.push(latency);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async initializeNativeSigner() {
    try {
      await nativeSigner.signPayload(this.secretKey, this.testPayload);
    } catch (error) {
      console.error("Failed to initialize native signer:", error);
      throw error;
    }
  }

  generateReport(): string {
    let report = "# Tokio Runtime Performance Report\n\n";
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += "## Benchmark Results\n\n";
    report +=
      "| Configuration | RPS | Success Rate | Avg Latency (ms) | P95 Latency (ms) | CPU Usage (%) | Memory (MB) |\n";
    report +=
      "|---------------|-----|--------------|------------------|------------------|--------------|-------------|\n";

    for (const result of this.results) {
      report += `| ${result.config.name} | ${result.requestsPerSecond.toFixed(2)} | ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}% | ${result.averageLatency.toFixed(2)} | ${result.p95Latency.toFixed(2)} | ${result.cpuUsage.toFixed(2)} | ${result.memoryUsage.toFixed(2)} |\n`;
    }

    report += "\n## Detailed Results\n\n";

    for (const result of this.results) {
      report += `### ${result.config.name}\n\n`;
      report += `- **Worker Threads**: ${result.config.workerThreads}\n`;
      report += `- **Max Blocking Threads**: ${result.config.maxBlockingThreads}\n`;
      report += `- **Stack Size**: ${result.config.stackSize / 1024 / 1024}MB\n`;
      report += `- **Concurrency**: ${result.config.concurrency}\n`;
      report += `- **Duration**: ${result.config.duration}s\n`;
      report += `- **Total Requests**: ${result.totalRequests}\n`;
      report += `- **Successful Requests**: ${result.successfulRequests}\n`;
      report += `- **Failed Requests**: ${result.failedRequests}\n`;
      report += `- **Requests per Second**: ${result.requestsPerSecond.toFixed(2)}\n`;
      report += `- **Average Latency**: ${result.averageLatency.toFixed(2)}ms\n`;
      report += `- **P95 Latency**: ${result.p95Latency.toFixed(2)}ms\n`;
      report += `- **P99 Latency**: ${result.p99Latency.toFixed(2)}ms\n`;
      report += `- **CPU Usage**: ${result.cpuUsage.toFixed(2)}%\n`;
      report += `- **Memory Usage**: ${result.memoryUsage.toFixed(2)}MB\n`;

      if (result.errors.length > 0) {
        report += `- **Errors**: ${result.errors.length}\n`;
        report += "  ```\n";
        result.errors.slice(0, 5).forEach((error) => {
          report += `  ${error}\n`;
        });
        if (result.errors.length > 5) {
          report += `  ... and ${result.errors.length - 5} more\n`;
        }
        report += "  ```\n";
      }
      report += "\n";
    }

    // Find best performing configuration
    const bestRPS = Math.max(...this.results.map((r) => r.requestsPerSecond));
    const bestConfig = this.results.find(
      (r) => r.requestsPerSecond === bestRPS,
    );

    if (bestConfig) {
      report += "## 🏆 Best Performing Configuration\n\n";
      report += `The **${bestConfig.config.name}** configuration achieved the highest throughput:\n\n`;
      report += `- **${bestRPS.toFixed(2)} requests per second**\n`;
      report += `- **${bestConfig.config.workerThreads} worker threads**\n`;
      report += `- **${bestConfig.config.maxBlockingThreads} max blocking threads**\n`;
      report += `- **${bestConfig.config.stackSize / 1024 / 1024}MB stack size**\n`;
    }

    return report;
  }
}

async function runAllBenchmarks(): Promise<void> {
  const tester = new LoadTester();

  const configs: BenchmarkConfig[] = [
    {
      name: "baseline_default",
      workerThreads: 1,
      maxBlockingThreads: 4,
      stackSize: 2 * 1024 * 1024,
      duration: 30,
      concurrency: 10,
    },
    {
      name: "optimized_num_cores",
      workerThreads: os.cpus().length,
      maxBlockingThreads: os.cpus().length * 4,
      stackSize: 2 * 1024 * 1024,
      duration: 30,
      concurrency: 50,
    },
    {
      name: "high_concurrency",
      workerThreads: os.cpus().length * 2,
      maxBlockingThreads: os.cpus().length * 8,
      stackSize: 4 * 1024 * 1024,
      duration: 30,
      concurrency: 100,
    },
    {
      name: "large_stack",
      workerThreads: os.cpus().length,
      maxBlockingThreads: os.cpus().length * 4,
      stackSize: 8 * 1024 * 1024,
      duration: 30,
      concurrency: 50,
    },
  ];

  console.log("🎯 Starting Tokio Runtime Performance Benchmarks");
  console.log(`System: ${os.cpus().length} CPU cores`);

  for (const config of configs) {
    await tester.runBenchmark(config);
  }

  const report = tester.generateReport();

  // Save report to file
  fs.writeFileSync("tokio_performance_report.md", report);

  console.log("\n📊 Performance report saved to tokio_performance_report.md");

  // Check if we achieved the 1000 RPS target
  const maxRPS = Math.max(...tester.results.map((r) => r.requestsPerSecond));
  if (maxRPS >= 1000) {
    console.log(
      `🎉 SUCCESS: Achieved ${maxRPS.toFixed(2)} RPS (target: 1000 RPS)`,
    );
  } else {
    console.log(
      `❌ FAILED: Only achieved ${maxRPS.toFixed(2)} RPS (target: 1000 RPS)`,
    );
  }
}

if (require.main === module) {
  runAllBenchmarks().catch(console.error);
}

export { BenchmarkConfig, BenchmarkResult, LoadTester };
