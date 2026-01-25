/**
 * Calculate Return on Investment (ROI)
 *
 * ROI = (profit / investedAmount) * 100
 */
export function calculateROI(
  investedAmount: number,
  totalReturns: number,
): number {
  if (!investedAmount || investedAmount <= 0) {
    return 0;
  }

  const profit = totalReturns - investedAmount;

  return Number(((profit / investedAmount) * 100).toFixed(2));
}
