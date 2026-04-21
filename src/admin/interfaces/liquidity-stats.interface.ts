export interface LiquidityStats {
  systemOperational: number; // Balance for fees/gas
  poolLiquidity: number; // Total in trading pools
  reserveFund: number; // Platform treasury
  healthScore: number; // 0-100 score based on coverage
}
