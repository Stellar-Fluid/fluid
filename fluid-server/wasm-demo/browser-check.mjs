import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, "server.mjs");

function browserExecutablePath() {
  const candidates = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function startServer() {
  return spawn(process.execPath, [serverScript], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: "4173" },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForServer(serverProcess) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for the demo server")), 15000);
    serverProcess.stdout.on("data", (chunk) => {
      const message = chunk.toString();
      if (message.includes("Fluid WASM demo server listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Demo server exited early with code ${code}`));
    });
  });
}

async function main() {
  const executablePath = browserExecutablePath();
  const serverProcess = startServer();
  try {
    await waitForServer(serverProcess);

    const browser = await chromium.launch(
      executablePath
        ? {
            executablePath,
            headless: true
          }
        : {
            headless: true
          }
    );

    try {
      const page = await browser.newPage();
      const consoleMessages = [];
      page.on("console", (message) => {
        consoleMessages.push(message.text());
      });

      await page.goto("http://127.0.0.1:4173/wasm-demo/index.html", {
        waitUntil: "networkidle"
      });

      await page.waitForFunction(() => document.body.dataset.status === "success", undefined, {
        timeout: 15000
      });

      const successMessage = consoleMessages.find((entry) =>
        entry.includes("WASM signing successful")
      );

      if (!successMessage) {
        throw new Error(`Expected browser console success log, got: ${consoleMessages.join(" | ")}`);
      }

      console.log(successMessage);
    } finally {
      await browser.close();
    }
  } finally {
    serverProcess.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
