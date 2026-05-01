import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { DistributionService } from './distribution.service';

// distribution.controller.ts
@UseGuards(JwtAuthGuard, RolesGuard) // Faisal: Ensure only Admins can drop money!
@Controller('finance/distributions')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Post('execute')
  async executeDistribution(
    @Body() dto: { assetId: string; totalAmount: number; period: string },
  ) {
    // 🏦 REAL WORLD FLOW:
    // 1. Faisal receives rent from property manager in corporate bank account.
    // 2. Faisal enters the amount here.
    // 3. System splits it perfectly among 1,000s of owners instantly.
    return this.distributionService.distributeIncome(
      dto.assetId,
      dto.totalAmount,
      dto.period,
    );
  }
}
