// WHAT kind of financial event this entry represents
export enum LedgerType {
  INVESTMENT = 'INVESTMENT', // investor added funds
  DISTRIBUTION = 'DISTRIBUTION', // profit/rent distributed
  PAYOUT = 'PAYOUT', // cash-out request
  REFUND = 'REFUND', // returned funds
  ADJUSTMENT = 'ADJUSTMENT', // admin adjustment
}
