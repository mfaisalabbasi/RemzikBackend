import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Param,
} from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';

@Controller('distributions')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  /**
   * ✅ FIXED: Destructured body parsing + Accurate Strategy property matching
   */
  @UseGuards(JwtAuthGuard)
  @Post('trigger-from-income')
  async triggerFromIncome(@Body() body: { incomeId: string }, @Request() req) {
    const incomeId = body?.incomeId;
    if (!incomeId) {
      throw new BadRequestException(
        'The payload field "incomeId" is missing or unreadable.',
      );
    }

    // 🛡️ MATCHES STRATEGY: Grab "userId", not "id"
    const partnerUserId = req.user?.userId;

    return await this.distributionService.triggerDistributionFromIncome(
      incomeId,
      partnerUserId,
    );
  }

  /**
   * ✅ FIXED: Legacy route property tracking adjustment
   */
  @UseGuards(JwtAuthGuard)
  @Post('partner/assets/:id/distribute')
  async distribute(
    @Param('id') assetId: string,
    @Body('amount') amount: number,
    @Request() req,
  ) {
    // 🛡️ MATCHES STRATEGY: Grab "userId"
    const partnerUserId = req.user?.userId;

    return await this.distributionService.triggerYieldDistribution(
      partnerUserId,
      assetId,
      amount,
    );
  }
}
