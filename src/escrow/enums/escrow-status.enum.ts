export enum EscrowStatus {
  LOCKED = 'LOCKED', // Standard trade start
  RELEASED = 'RELEASED', // Funds sent to seller
  DISPUTED = 'DISPUTED', // Flagged for review
  REFUNDED = 'REFUNDED', // Funds returned to buyer
  FROZEN = 'FROZEN', // Compliance/Regulatory hold
}
