import {
  Controller,
  Post,
  Get,
  Req,
  UseGuards,
  Patch,
  Body,
} from '@nestjs/common';
import { InvestorService } from './investor.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('investors')
export class InvestorController {
  constructor(private readonly investorService: InvestorService) {}

  @Post('me')
  @Roles(UserRole.INVESTOR)
  createMyProfile(@Req() req) {
    return this.investorService.createProfile(req.user.userId);
  }

  @Get('me')
  @Roles(UserRole.INVESTOR)
  getMyProfile(@Req() req) {
    return this.investorService.getMyProfile(req.user.userId);
  }

  // ✅ FIXED: Added for Secondary Market Frontend
  @Get('my-positions')
  @Roles(UserRole.INVESTOR)
  getMyPositions(@Req() req) {
    return this.investorService.getSecondaryMarketPositions(req.user.userId);
  }

  @Get('profile')
  @Roles(UserRole.INVESTOR)
  getProfile(@Req() req) {
    return this.investorService.getProfileData(req.user.userId);
  }

  @Patch('profile')
  @Roles(UserRole.INVESTOR)
  updateProfile(@Req() req, @Body() body) {
    return this.investorService.updateProfile(req.user.userId, body);
  }

  @Get('dashboard')
  getDashboard(@Req() req) {
    return this.investorService.getDashboard(req.user.userId);
  }
}
