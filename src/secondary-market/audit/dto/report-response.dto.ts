export class ReportResponseDto {
  totalInvested: number;
  totalDistributed: number;
  totalPayouts: number;
  totalAssets: number;
  ledgerEntries: any[]; // detailed ledger entries
  trades?: any[]; // secondary market trades if applicable
}
