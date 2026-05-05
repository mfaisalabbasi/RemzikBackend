// src/distribution/distribution.controller.ts
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
@Controller('partner/assets')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':id/distribute')
  async distribute(
    @Param('id') assetId: string,
    @Body('amount') amount: number,
    @Request() req,
  ) {
    // req.user.id is the Partner's User ID from the JWT
    return await this.distributionService.triggerYieldDistribution(
      req.user.id,
      assetId,
      amount,
    );
  }
}
