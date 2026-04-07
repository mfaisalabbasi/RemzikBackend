import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { DepositService } from './deposit.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.gaurd';

@UseGuards(JwtAuthGuard)
@Controller('finance/deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post('simulate')
  async simulate(@Req() req, @Body() dto: { amount: number }) {
    return this.depositService.processSimulation(req.user.userId, dto.amount);
  }
}
