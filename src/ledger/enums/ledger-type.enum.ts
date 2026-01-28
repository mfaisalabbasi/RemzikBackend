// WHAT kind of financial event this entry represents
export enum LedgerType {
  INVESTMENT = 'INVESTMENT', // investor added funds
  DISTRIBUTION = 'DISTRIBUTION', // profit/rent distributed
  PAYOUT = 'PAYOUT', // cash-out request
  REFUND = 'REFUND', // returned funds
  ADJUSTMENT = 'ADJUSTMENT', // admin adjustment
  CREDIT = 'CREDIT', // admin adjustment
  DISPUTE_ADJUSTMENT = 'DISPUTE_ADJUSTMENT',
  ESCROW_LOCK = 'ESCROW_LOCK',
  ESCROW_RELEASE = 'ESCROW_RELEASE',
  WITHDRAWAL_REQUEST = 'WITHDRAWAL_REQUEST',
  WITHDRAWAL_PAID = 'WITHDRAWAL_PAID',
}
