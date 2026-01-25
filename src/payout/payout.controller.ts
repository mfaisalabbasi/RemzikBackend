import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.gaurd';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Roles(UserRole.INVESTOR)
  @Post('request')
  async requestPayout(@Req() req, @Body() dto: CreatePayoutDto) {
    return this.payoutService.requestPayout(req.user, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePayoutStatusDto,
  ) {
    return this.payoutService.updatePayoutStatus(id, dto);
  }

  @Roles(UserRole.INVESTOR)
  @Get('me')
  async getMyPayouts(@Req() req) {
    return this.payoutService.getUserPayouts(req.user.userId);
  }

  @Roles(UserRole.ADMIN)
  @Get()
  async getAll() {
    return this.payoutService.getAllPayouts();
  }
}
