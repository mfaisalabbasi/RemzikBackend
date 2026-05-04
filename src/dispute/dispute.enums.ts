// dispute.enums.ts

export enum DisputeStatus {
  OPEN = 'OPEN', // Initial claim filed
  UNDER_REVIEW = 'UNDER_REVIEW', // Admin has actively started investigation
  PENDING_EVIDENCE = 'PENDING_EVIDENCE', // Waiting for user/seller documents
  ESCALATED = 'ESCALATED', // Moved to senior legal/compliance team
  RESOLVED_FAVOR_BUYER = 'RESOLVED_FAVOR_BUYER', // Funds returned to buyer
  RESOLVED_FAVOR_SELLER = 'RESOLVED_FAVOR_SELLER', // Funds released to seller
  REJECTED = 'REJECTED', // Dispute dismissed (funds remain in current state)
  FROZEN = 'FROZEN', // Funds locked indefinitely due to legal/AML concerns
}

export enum DisputeType {
  INVESTMENT = 'INVESTMENT',
  PAYOUT = 'PAYOUT',
  TRADE = 'TRADE',
  WITHDRAWAL = 'WITHDRAWAL',
  SECONDARY_TRADE = 'SECONDARY_TRADE',
  AML_SUSPICION = 'AML_SUSPICION', // Fintech grade: System-triggered flag
  FRAUD_CLAIM = 'FRAUD_CLAIM', // High-priority user-triggered flag
}
