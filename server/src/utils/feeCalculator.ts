import * as StellarSdk from "@stellar/stellar-sdk";

export function calculateFeeBumpFee(
  innerTransaction: StellarSdk.Transaction,
  baseFee: number,
  multiplier: number = 1,
): number {
  // Existing logic (preserved)
  const operationCount = innerTransaction.operations.length;
  const calculatedFee = (operationCount + 1) * baseFee;

  // Detect Soroban
  const isSoroban = innerTransaction.operations.some(
    (op: any) => op.type === "invokeHostFunction"
  );

  // Extract Soroban resource fee
  let sorobanFee = 0;
  const anyTx: any = innerTransaction;

  if (isSoroban && anyTx.sorobanData) {
    sorobanFee = Number(anyTx.sorobanData.resourceFee || 0);
  }

  // Final fee
  const totalFee = Math.ceil(calculatedFee * multiplier) + sorobanFee;

  // Debug logs (important for PR proof)
  console.log("=== Fee Calculation ===");
  console.log("Operation Count:", operationCount);
  console.log("Base Fee:", baseFee);
  console.log("Multiplier:", multiplier);
  console.log("Calculated Fee:", calculatedFee);
  console.log("Is Soroban:", isSoroban);
  console.log("Soroban Fee:", sorobanFee);
  console.log("Total Fee:", totalFee);

  return totalFee;
}
