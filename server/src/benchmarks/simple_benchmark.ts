import * as fs from "fs";
import * as os from "os";
import { performance } from "perf_hooks";
import { nativeSigner } from "../signing/native";

interface BenchmarkResult {
  configuration: string;
  workerThreads: number;
  maxBlockingThreads: number;
  stackSize: number;
  requestsPerSecond: number;
  averageLatency: number;
  successRate: number;
  totalRequests: number;
  duration: number;
}

class SimpleBenchmark {
  private secretKey =
    "SC6KWQBWRYDU3KMWOZZLFC5FRJEG3FN6HRG6V6OX5GIWTBQ5T35R3JGM";
  private testPayload = Buffer.alloc(100, 1);

  async runSingleBenchmark(
    name: string,
    workerThreads: number,
    maxBlockingThreads: number,
    stackSize: number,
    duration: number = 30,
  ): Promise<BenchmarkResult> {
    console.log(`\n🚀 Running benchmark: ${name}`);
    console.log(
      `Worker threads: ${workerThreads}, Max blocking: ${maxBlockingThreads}, Stack: ${stackSize / 1024 / 1024}MB`,
    );

    // Set environment variables for Rust runtime
    process.env.FLUID_TOKIO_WORKER_THREADS = workerThreads.toString();
    process.env.FLUID_TOKIO_MAX_BLOCKING_THREADS =
      maxBlockingThreads.toString();
    process.env.FLUID_TOKIO_STACK_SIZE = stackSize.toString();

    const startTime = performance.now();
    const endTime = startTime + duration * 1000;

    let totalRequests = 0;
    let successfulRequests = 0;
    const latencies: number[] = [];

    // Warm up
    try {
      await nativeSigner.signPayload(this.secretKey, this.testPayload);
    } catch (error) {
      console.error("Warm up failed:", error);
      throw error;
    }

    // Main benchmark loop
    while (performance.now() < endTime) {
      try {
        const requestStart = performance.now();
        await nativeSigner.signPayload(this.secretKey, this.testPayload);
        const latency = performance.now() - requestStart;

        latencies.push(latency);
        successfulRequests++;
      } catch (error) {
        // Count as failed request
      }
      totalRequests++;
    }

    const actualDuration = (performance.now() - startTime) / 1000;
    const requestsPerSecond = totalRequests / actualDuration;
    const successRate = (successfulRequests / totalRequests) * 100;
    const averageLatency =
      latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;

    console.log(
      `✅ ${name}: ${requestsPerSecond.toFixed(2)} RPS, ${successRate.toFixed(2)}% success, ${averageLatency.toFixed(2)}ms avg latency`,
    );

    return {
      configuration: name,
      workerThreads,
      maxBlockingThreads,
      stackSize,
      requestsPerSecond,
      averageLatency,
      successRate,
      totalRequests,
      duration: actualDuration,
    };
  }

  generateReport(results: BenchmarkResult[]): string {
    let report = "# Tokio Runtime Performance Report\n\n";
    report += `Generated: ${new Date().toISOString()}\n`;
    report += `System: ${os.cpus().length} CPU cores\n\n`;

    report += "## Results Summary\n\n";
    report +=
      "| Configuration | Worker Threads | Max Blocking | Stack (MB) | RPS | Success Rate | Avg Latency (ms) |\n";
    report +=
      "|---------------|----------------|--------------|-----------|-----|--------------|------------------|\n";

    for (const result of results) {
      report += `| ${result.configuration} | ${result.workerThreads} | ${result.maxBlockingThreads} | ${result.stackSize / 1024 / 1024} | ${result.requestsPerSecond.toFixed(2)} | ${result.successRate.toFixed(2)}% | ${result.averageLatency.toFixed(2)} |\n`;
    }

    // Find best performing configuration
    const bestRPS = Math.max(...results.map((r) => r.requestsPerSecond));
    const bestConfig = results.find((r) => r.requestsPerSecond === bestRPS);

    if (bestConfig) {
      report += "\n## 🏆 Best Performance\n\n";
      report += `**${bestConfig.configuration}** achieved **${bestRPS.toFixed(2)} RPS**\n\n`;
      report += `- Worker threads: ${bestConfig.workerThreads}\n`;
      report += `- Max blocking threads: ${bestConfig.maxBlockingThreads}\n`;
      report += `- Stack size: ${bestConfig.stackSize / 1024 / 1024}MB\n`;
      report += `- Average latency: ${bestConfig.averageLatency.toFixed(2)}ms\n`;
      report += `- Success rate: ${bestConfig.successRate.toFixed(2)}%\n`;
    }

    // Target achievement
    report += "\n## Target Achievement\n\n";
    if (bestRPS >= 1000) {
      report += `✅ **SUCCESS**: Achieved ${bestRPS.toFixed(2)} RPS (target: 1000 RPS)\n`;
    } else {
      report += `❌ **FAILED**: Only achieved ${bestRPS.toFixed(2)} RPS (target: 1000 RPS)\n`;
    }

    report += "\n## Detailed Results\n\n";
    for (const result of results) {
      report += `### ${result.configuration}\n\n`;
      report += `- **Total requests**: ${result.totalRequests}\n`;
      report += `- **Duration**: ${result.duration.toFixed(2)}s\n`;
      report += `- **Requests per second**: ${result.requestsPerSecond.toFixed(2)}\n`;
      report += `- **Success rate**: ${result.successRate.toFixed(2)}%\n`;
      report += `- **Average latency**: ${result.averageLatency.toFixed(2)}ms\n`;
      report += "\n";
    }

    return report;
  }
}

async function runBenchmarks(): Promise<void> {
  const benchmark = new SimpleBenchmark();
  const results: BenchmarkResult[] = [];

  const numCores = os.cpus().length;

  // Test configurations
  const configs = [
    {
      name: "baseline_default",
      workerThreads: 1,
      maxBlockingThreads: 4,
      stackSize: 2 * 1024 * 1024,
    },
    {
      name: "optimized_num_cores",
      workerThreads: numCores,
      maxBlockingThreads: numCores * 4,
      stackSize: 2 * 1024 * 1024,
    },
    {
      name: "high_concurrency",
      workerThreads: numCores * 2,
      maxBlockingThreads: numCores * 8,
      stackSize: 4 * 1024 * 1024,
    },
    {
      name: "large_stack",
      workerThreads: numCores,
      maxBlockingThreads: numCores * 4,
      stackSize: 8 * 1024 * 1024,
    },
    {
      name: "max_performance",
      workerThreads: numCores * 4,
      maxBlockingThreads: numCores * 16,
      stackSize: 4 * 1024 * 1024,
    },
  ];

  console.log("🎯 Starting Tokio Runtime Performance Benchmarks");
  console.log(`System: ${numCores} CPU cores`);

  for (const config of configs) {
    try {
      const result = await benchmark.runSingleBenchmark(
        config.name,
        config.workerThreads,
        config.maxBlockingThreads,
        config.stackSize,
      );
      results.push(result);
    } catch (error) {
      console.error(`❌ Benchmark ${config.name} failed:`, error);
    }
  }

  if (results.length > 0) {
    const report = benchmark.generateReport(results);
    fs.writeFileSync("tokio_performance_report.md", report);
    console.log("\n📊 Performance report saved to tokio_performance_report.md");

    // Show summary
    const bestRPS = Math.max(...results.map((r) => r.requestsPerSecond));
    console.log(`\n🏆 Best performance: ${bestRPS.toFixed(2)} RPS`);

    if (bestRPS >= 1000) {
      console.log("🎉 SUCCESS: Achieved 1000+ RPS target!");
    } else {
      console.log("❌ FAILED: Did not achieve 1000+ RPS target");
    }
  } else {
    console.log("❌ No benchmarks completed successfully");
  }
}

if (require.main === module) {
  runBenchmarks().catch(console.error);
}

export { BenchmarkResult, SimpleBenchmark };
