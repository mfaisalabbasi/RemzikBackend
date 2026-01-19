import {
  Controller,
  Post,
  Patch,
  Body,
  Req,
  Param,
  UseGuards,
} from '@nestjs/common';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // USER submits KYC
  @Post('submit')
  @Roles(UserRole.INVESTOR, UserRole.PARTNER)
  submit(@Req() req, @Body() dto: SubmitKycDto) {
    return this.kycService.submitKyc(req.user.userId, dto);
  }

  // ADMIN reviews KYC
  @Patch(':id/review')
  @Roles(UserRole.ADMIN)
  review(@Param('id') id: string, @Body() dto: ReviewKycDto) {
    return this.kycService.reviewKyc(id, dto);
  }
}
