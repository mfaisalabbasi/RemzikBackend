export interface ComplianceStatus {
  regulatoryHealth: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
  lastAuditDate: Date | null;
  issuesCount: number;
}
