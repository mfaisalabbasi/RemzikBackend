import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
@Controller('distributions')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  /**
   * ✅ NEW ENDPOINT: Triggered from Income Report
   * Frontend: poster(`/distributions/trigger-from-income`, { incomeId })
   */
  @UseGuards(JwtAuthGuard)
  @Post('trigger-from-income')
  async triggerFromIncome(@Body('incomeId') incomeId: string, @Request() req) {
    const partnerUserId = req.user.id;
    return await this.distributionService.triggerDistributionFromIncome(
      incomeId,
      partnerUserId,
    );
  }

  /**
   * LEGACY/MANUAL ENDPOINT
   * Frontend: poster(`/partner/assets/${assetId}/distribute`, { amount })
   */
  @UseGuards(JwtAuthGuard)
  @Post('partner/assets/:id/distribute')
  async distribute(
    @Param('id') assetId: string,
    @Body('amount') amount: number,
    @Request() req,
  ) {
    return await this.distributionService.triggerYieldDistribution(
      req.user.id,
      assetId,
      amount,
    );
  }
}
