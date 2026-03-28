import { defineConfig } from "tsup";

export default defineConfig([
  // Existing ESM/CJS build (unchanged behaviour)
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    platform: "browser",
    skipNodeModulesBundle: false,
    esbuildOptions(options) {
      options.define = {
        ...options.define,
        "process.env.NODE_ENV": '"production"',
      };
    },
  },
  // Standalone IIFE bundle for CDN / <script> tag usage
  {
    entry: { fluid: "src/standalone.ts" },
    format: ["iife"],
    globalName: "Fluid",
    minify: true,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    platform: "browser",
    // Rename output from fluid.global.js → fluid.min.js
    outExtension: () => ({ js: ".min.js" }),
    // Bundle @stellar/stellar-sdk so the output is fully self-contained
    noExternal: [/.*/],
    esbuildOptions(options) {
      options.define = {
        ...options.define,
        "process.env.NODE_ENV": '"production"',
        // Prevent dotenv / Node built-ins from breaking in the browser
        "process.env": "{}",
        global: "globalThis",
      };
    },
  },
]);
