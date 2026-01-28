import { Controller, Post, Body } from '@nestjs/common';
import { AuditService } from './audit.service';
import { GenerateReportDto } from './dto/generate-report.dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post('generate')
  async generate(@Body() dto: GenerateReportDto) {
    return this.auditService.generateReport(dto);
  }
}
