import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AssetService } from './asset.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset.dto';
import { KycGuard } from 'src/auth/guards/kyc.guard';
import { PartnerApprovedGuard } from 'src/auth/guards/partner-approved.guard';

@UseGuards(
  JwtAuthGuard,
  RolesGuard,
  // KycGuard,
  // PartnerApprovedGuard
)
@Controller('assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  /**
   * PARTNER submits asset
   */
  @Post()
  @Roles(UserRole.PARTNER)
  create(@Req() req, @Body() dto: CreateAssetDto) {
    return this.assetService.createAsset(req.user.userId, dto);
  }

  /**
   * ADMIN approves / rejects asset
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateAssetStatusDto) {
    return this.assetService.updateAssetStatus(id, dto.status);
  }

  /**
   * INVESTORS browse approved assets
   */
  @Get()
  getApproved() {
    return this.assetService.getApprovedAssets();
  }
}
