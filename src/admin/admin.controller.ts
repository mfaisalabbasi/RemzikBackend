import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Patch,
  Query,
  NotFoundException,
  UnauthorizedException,
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

  @Get('notifications')
  @Roles(UserRole.INVESTOR, UserRole.PARTNER, UserRole.ADMIN)
  async getUserNotifications(
    @Query('userId') userId: string,
    @Query('role') role: string,
  ) {
    return this.broadcastService.getRecent(20, userId, role);
  }

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
    return await this.broadcastService.create(dto, req.user.userId);
  }

  @Get('investors')
  @Roles(UserRole.ADMIN)
  async getInvestors() {
    return this.adminService.getInvestorsList();
  }

  @Get('investors/:id')
  @Roles(UserRole.ADMIN)
  async getInvestorDetail(@Param('id') id: string) {
    return this.adminService.getInvestorDetail(id);
  }

  @Patch('investors/:id/approve-kyc')
  @Roles(UserRole.ADMIN)
  async approveKyc(@Param('id') id: string, @Req() req) {
    // FIXED: Passing req.user.userId
    return this.adminService.approveKyc(id, req.user.userId);
  }

  @Patch('investors/:id/toggle-freeze')
  @Roles(UserRole.ADMIN)
  async toggleFreeze(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req,
  ) {
    // FIXED: Passing req.user.userId
    return this.adminService.toggleAccountFreeze(id, reason, req.user.userId);
  }

  @Patch('investors/:userId/broadcast')
  @Roles(UserRole.ADMIN)
  async sendTargetedBroadcast(
    @Param('userId') userId: string,
    @Body() dto: { title: string; message: string; type: any },
  ) {
    return this.broadcastService.sendTargeted(
      userId,
      dto.title,
      dto.message,
      dto.type,
    );
  }

  @Get('partners')
  @Roles(UserRole.ADMIN)
  async getPartners() {
    return this.adminService.getPartnersList();
  }

  @Get('partners/:id')
  @Roles(UserRole.ADMIN)
  async getPartnerDetail(@Param('id') id: string) {
    return this.adminService.getPartnerDetail(id);
  }

  @Post('partners/message')
  async sendPartnerMessage(
    @Body()
    body: {
      userId: string;
      title: string;
      message: string;
      priority: string;
    },
  ) {
    return await this.broadcastService.sendTargeted(
      body.userId,
      body.title,
      body.message,
      body.priority === 'HIGH' ? 'URGENT' : 'DIRECTIVE',
    );
  }

  @Patch('partners/:id/status')
  @Roles(UserRole.ADMIN)
  async updatePartnerStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Req() req,
  ) {
    // FIXED: Passing req.user.userId
    return await this.adminService.updatePartnerStatus(
      id,
      status,
      req.user.userId,
    );
  }

  @Get('assets')
  async getAllAssets() {
    return await this.adminService.findAllAssets();
  }

  @Get('assets/:id')
  async getAssetById(@Param('id') id: string) {
    const asset = await this.adminService.findAssetDetail(id);
    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }
    return asset;
  }

  @Patch('assets/:id/status')
  @Roles(UserRole.ADMIN)
  async updateAssetStatus(
    @Param('id') id: string,
    @Body() body: { status: string; rejectionReason?: string },
    @Req() req,
  ) {
    // FIXED: Passing req.user.userId and fallback for reason
    return await this.adminService.updateAssetStatus(
      id,
      body.status,
      req.user.userId,
      body.rejectionReason || '',
    );
  }

  @Get('assets/:id/activity')
  @Roles(UserRole.ADMIN)
  async getAssetActivity(@Param('id') assetId: string) {
    return this.adminService.getAssetActivity(assetId);
  }

  @Get('me')
  @Roles(UserRole.ADMIN)
  async getMe(@Req() req) {
    return this.adminService.getAdminIdentity(req.user.userId);
  }

  @Get('my-activity')
  @Roles(UserRole.ADMIN)
  async getMyActivity(@Req() req) {
    return this.adminService.getMyAdminActivity(req.user.userId);
  }
}
