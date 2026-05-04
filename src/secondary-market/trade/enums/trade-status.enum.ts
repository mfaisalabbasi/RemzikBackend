export enum TradeStatus {
  PENDING = 'PENDING', // Initial listing/order state
  LOCKED = 'LOCKED', // 🛡️ Funds in Escrow (Required for Dispute button)
  DISPUTED = 'DISPUTED', // 🚩 Funds frozen due to user report
  COMPLETED = 'COMPLETED', // Funds released to seller
  CANCELLED = 'CANCELLED', // Trade aborted
}
