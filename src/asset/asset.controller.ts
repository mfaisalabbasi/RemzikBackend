import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AssetService } from './asset.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset.dto';
import { KycGuard } from 'src/auth/guards/kyc.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  @UseGuards(KycGuard)
  @Roles(UserRole.PARTNER)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'galleryImages', maxCount: 10 },
        { name: 'legalDocuments', maxCount: 10 },
        { name: 'financialDocuments', maxCount: 10 },
        { name: 'otherDocuments', maxCount: 10 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
      },
    ),
  )
  create(@Req() req, @Body() dto: CreateAssetDto, @UploadedFiles() files) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.createAsset(userId, dto, files || {});
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateAssetStatusDto) {
    if (dto.status === 'APPROVED') return this.assetService.approve(id);
    if (dto.status === 'REJECTED')
      return this.assetService.reject(id, dto.reason || '');
    if (dto.status === 'FREEZ') return this.assetService.freeze(id);
    throw new BadRequestException('Invalid status');
  }

  @Get('partner/assets')
  @Roles(UserRole.PARTNER)
  getPartnerAssets(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getAssetsByPartner(userId);
  }

  @Get('partner/investors')
  @Roles(UserRole.PARTNER)
  getPartnerInvestors(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerInvestors(userId);
  }

  @Get('partner/withdrawals')
  @Roles(UserRole.PARTNER)
  getWithdrawals(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerWithdrawals(userId);
  }

  @Get('partner/recent-activity')
  @Roles(UserRole.PARTNER)
  getRecentActivity(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getRecentActivity(userId);
  }

  @Get('partner/kpi')
  @Roles(UserRole.PARTNER)
  getPartnerKPI(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerKPI(userId);
  }

  @Get('partner/live-funding')
  @Roles(UserRole.PARTNER)
  getLiveFunding(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerLiveFunding(userId);
  }

  @Get('partner/performance')
  @Roles(UserRole.PARTNER)
  getPerformance(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerPerformance(userId);
  }

  @Get('partner/funding-table')
  @Roles(UserRole.PARTNER)
  getFundingTable(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerFundingTable(userId);
  }

  @Get()
  getApproved() {
    return this.assetService.getApprovedAssets();
  }

  @Get(':id')
  getAsset(@Param('id') id: string) {
    return this.assetService.getAssetById(id);
  }

  @Get('partner/funding')
  @Roles(UserRole.PARTNER)
  getPartnerFunding(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerFunding(userId);
  }

  @Get('partner/distributions')
  @Roles(UserRole.PARTNER)
  getPartnerDistributions(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerDistributions(userId);
  }

  @Get('partner/documents')
  @Roles(UserRole.PARTNER)
  getPartnerDocuments(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.assetService.getPartnerDocuments(userId);
  }
}
