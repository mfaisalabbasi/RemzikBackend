import { ReportType } from '../enums/report-type.enum';

export class GenerateReportDto {
  reportType: ReportType;
  userId?: string; // for INVESTOR reports
  partnerId?: string; // for PARTNER reports
  startDate: string; // ISO string
  endDate: string; // ISO string
}
