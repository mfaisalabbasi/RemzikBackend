import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminActionDto } from './dto/admin-action.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';
import { UrgentTask } from './interfaces/urgent-task.interface';
import { ComplianceStatus } from './interfaces/compliance-status.interface';
import { LiquidityStats } from './interfaces/liquidity-stats.interface';
import { BroadcastService } from '../broadcast/broadcast.service';
import { CreateBroadcastDto } from '../broadcast/dto/create-broadcast.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly broadcastService: BroadcastService,
  ) {}

  @Get('urgent-queue')
  @Roles(UserRole.ADMIN)
  async getQueue(): Promise<UrgentTask[]> {
    return this.adminService.getUrgentQueue();
  }

  @Post('partner-action')
  @Roles(UserRole.ADMIN)
  handlePartner(@Body() dto: AdminActionDto, @Req() req) {
    return this.adminService.handlePartnerAction(dto, req.user.userId);
  }

  @Post('asset-action')
  @Roles(UserRole.ADMIN)
  handleAsset(@Body() dto: AdminActionDto, @Req() req) {
    return this.adminService.handleAssetAction(dto, req.user.userId);
  }

  @Post('kyc-action')
  @Roles(UserRole.ADMIN)
  handleKyc(@Body() dto: AdminActionDto, @Req() req) {
    return this.adminService.handleKycAction(dto, req.user.userId);
  }

  @Get('pipeline-snapshot')
  @Roles(UserRole.ADMIN)
  async getPipelineSnapshot() {
    return this.adminService.getDashboardPipeline();
  }

  @Get('compliance-status')
  @Roles(UserRole.ADMIN)
  async getCompliance(): Promise<ComplianceStatus> {
    return this.adminService.getComplianceStatus();
  }

  @Get('liquidity-monitor')
  @Roles(UserRole.ADMIN)
  async getLiquidity(): Promise<LiquidityStats> {
    return this.adminService.getLiquidityStats();
  }

  @Get('broadcasts')
  @Roles(UserRole.ADMIN)
  async getBroadcasts() {
    return this.broadcastService.getRecent();
  }

  @Post('broadcasts')
  @Roles(UserRole.ADMIN)
  async sendBroadcast(@Body() dto: CreateBroadcastDto, @Req() req) {
    // Ensuring result returns the full object with ID for the admin dashboard list
    return await this.broadcastService.create(dto, req.user.userId);
  }

  @Get('investors')
  @Roles(UserRole.ADMIN)
  async getInvestors() {
    // This calls the method we added to your AdminService
    return this.adminService.getInvestorsList();
  }

  @Get('investors/:id')
  @Roles(UserRole.ADMIN)
  async getInvestorDetail(@Param('id') id: string) {
    return this.adminService.getInvestorDetail(id);
  }
  @Patch('investors/:id/approve-kyc')
  async approveKyc(@Param('id') id: string) {
    return this.adminService.approveKyc(id);
  }

  @Patch('investors/:id/toggle-freeze')
  async toggleFreeze(@Param('id') id: string, @Body('reason') reason: string) {
    return this.adminService.toggleAccountFreeze(id, reason);
  }
}
