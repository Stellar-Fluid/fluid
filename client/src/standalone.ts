/**
 * Fluid Standalone Bundle Entry Point
 *
 * This file is the entry point for the browser IIFE/UMD bundle.
 * It exports all public API under the global `Fluid` namespace so developers
 * can use the SDK with a plain <script> tag — no build tool required.
 *
 * Usage:
 *   <script src="https://unpkg.com/fluid-client/dist/fluid.min.js"></script>
 *   <script>
 *     const client = new Fluid.FluidClient({ ... });
 *   </script>
 */

export { FluidClient } from "./FluidClient";
export type {
  FluidClientConfig,
  FeeBumpResponse,
  FeeBumpRequestInput,
  FeeBumpRequestBody,
  FeeBumpBatchRequestBody,
  XdrSerializableTransaction,
} from "./FluidClient";

export const VERSION = "0.1.0";
