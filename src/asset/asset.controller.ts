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
import { PartnerApprovedGuard } from 'src/auth/guards/partner-approved.guard';

const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];

function fileFilter(req: any, file: Express.Multer.File, callback: any) {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return callback(
      new BadRequestException(
        'Invalid file type. Only JPG, PNG, and PDF files are allowed.',
      ),
      false,
    );
  }

  callback(null, true);
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  /**
   * Partner submits asset
   */
  @Post()
  @UseGuards(
    KycGuard,
    //  PartnerApprovedGuard
  )
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
        limits: {
          fileSize: 5 * 1024 * 1024,
        },
        fileFilter,
      },
    ),
  )
  create(
    @Req() req,
    @Body() dto: CreateAssetDto,
    @UploadedFiles()
    files: {
      galleryImages?: Express.Multer.File[];
      legalDocuments?: Express.Multer.File[];
      financialDocuments?: Express.Multer.File[];
      otherDocuments?: Express.Multer.File[];
    },
  ) {
    return this.assetService.createAsset(req.user.userId, dto, files || {});
  }

  /**
   * Admin approves / rejects asset
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAssetStatusDto,
  ) {
    if (dto.status === 'APPROVED') {
      return this.assetService.approve(id);
    }

    if (dto.status === 'REJECTED') {
      return this.assetService.reject(id, dto.reason || 'Rejected by admin');
    }

    if (dto.status === 'FREEZ') {
      return this.assetService.freeze(id);
    }

    throw new Error('Invalid status');
  }

  /**
   * Investors browse approved assets
   */
  @Get()
  getApproved() {
    return this.assetService.getApprovedAssets();
  }

  @Get('partner/performance')
  @Roles(UserRole.PARTNER)
  getPerformance(@Req() req) {
    return this.assetService.getPartnerPerformance(req.user.id);
  }

  @Get('partner/kpi')
  getKPI(@Req() req) {
    return this.assetService.getPartnerKPI(req.user.id);
  }

  @Get('partner/live-funding')
  getLiveFunding(@Req() req) {
    return this.assetService.getPartnerLiveFunding(req.user.id);
  }

  @Get('partner/funding-table')
  getFundingTable(@Req() req) {
    return this.assetService.getPartnerFundingTable(req.user.id);
  }

  @Get('partner/activity')
  getActivity(@Req() req) {
    return this.assetService.getRecentActivity(req.user.id);
  }

  @Get('partner/assets')
  getPartnerAssets(@Req() req) {
    return this.assetService.getPartnerAssets(req.user.id);
  }

  @Get('partner/investors')
  getInvestors(@Req() req) {
    return this.assetService.getPartnerInvestors(req.user.id);
  }

  @Get('partner/withdrawals')
  getWithdrawals(@Req() req) {
    return this.assetService.getWithdrawalRequests(req.user.id);
  }

  @Get('partner/funding')
  getPartnerFunding(@Req() req) {
    return this.assetService.getPartnerFunding(req.user.id);
  }

  @Get('partner/distributions')
  getDistributions(@Req() req) {
    return this.assetService.getPartnerDistributions(req.user.id);
  }

  @Get('partner/documents')
  getPartnerDocs(@Req() req) {
    return this.assetService.getPartnerDocuments(req.user.id);
  }
}
