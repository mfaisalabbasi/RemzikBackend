import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RevenueService } from './revenue.service';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('revenues')
export class RevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  @Post('record/:assetId')
  recordRevenue(
    @Param('assetId') assetId: string,
    @Body('amount') amount: number,
  ) {
    return this.revenueService.recordRevenue(assetId, amount);
  }

  @Post('distribute/:revenueId')
  distributeRevenue(@Param('revenueId') revenueId: string) {
    return this.revenueService.distributeRevenue(revenueId);
  }

  @Patch('payout/:payoutId/complete')
  completePayout(@Param('payoutId') payoutId: string) {
    return this.revenueService.markPayoutCompleted(payoutId);
  }
}
