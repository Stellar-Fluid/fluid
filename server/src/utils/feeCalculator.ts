export function calculateFeeBumpFee(
  innerTransactionOrOperationCount: any,
  baseFee: number,
  multiplier: number = 1
): number {
  const operationCount =
    typeof innerTransactionOrOperationCount === "number"
      ? innerTransactionOrOperationCount
      : innerTransactionOrOperationCount?.operations?.length || 0;

  const innerFee =
    typeof innerTransactionOrOperationCount === "object"
      ? parseInt(innerTransactionOrOperationCount?.fee || "0", 10)
      : 0;

  const calculatedBaseFee = Math.ceil((operationCount + 1) * baseFee * multiplier);

  return Math.max(calculatedBaseFee, innerFee + baseFee);
}
