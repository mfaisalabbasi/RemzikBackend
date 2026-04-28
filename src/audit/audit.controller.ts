// audit.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AdminAction } from './enums/audit-action.enum';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Specifically for the Dashboard activity feed
   * GET /api/audit/recent
   */
  @Get('recent')
  @Roles(UserRole.ADMIN)
  async getRecentLogs() {
    return this.auditService.findRecent();
  }

  /**
   * Full history with optional filtering
   * GET /api/audit
   */
  @Get()
  @Roles(UserRole.ADMIN)
  async getLogs(@Query('action') action?: AdminAction) {
    return this.auditService.findAll(action);
  }

  @Get('target/:id') // New route: GET /api/audit/target/098118...
  @Roles(UserRole.ADMIN)
  async getLogsByTarget(@Param('id') targetId: string) {
    return this.auditService.findByTarget(targetId);
  }
}
