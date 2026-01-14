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
import { KycService } from './kyc.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  /**
   * USER submits KYC (Investor or Partner)
   */
  @Post('submit')
  @Roles(UserRole.INVESTOR, UserRole.PARTNER)
  submit(@Req() req, @Body() dto: SubmitKycDto) {
    return this.kycService.submitKyc(req.user, dto);
  }

  /**
   * ADMIN reviews KYC
   */
  @Patch(':id/review')
  @Roles(UserRole.ADMIN)
  review(@Param('id') id: string, @Body() dto: ReviewKycDto) {
    return this.kycService.reviewKyc(id, dto);
  }

  /**
   * USER views own KYC
   */
  @Get('me')
  @Roles(UserRole.INVESTOR, UserRole.PARTNER)
  getMy(@Req() req) {
    return this.kycService.getMyKyc(req.user.userId);
  }
}
