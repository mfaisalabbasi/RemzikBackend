import { Controller, Post, Get, Req, UseGuards } from '@nestjs/common';
import { InvestorService } from './investor.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('investors')
export class InvestorController {
  constructor(private readonly investorService: InvestorService) {}

  /**
   * INVESTOR creates profile
   */
  @Post('me')
  @Roles(UserRole.INVESTOR)
  createMyProfile(@Req() req) {
    return this.investorService.createProfile(req.user);
  }

  /**
   * INVESTOR views profile
   */
  @Get('me')
  @Roles(UserRole.INVESTOR)
  getMyProfile(@Req() req) {
    return this.investorService.getMyProfile(req.user.userId);
  }
}
