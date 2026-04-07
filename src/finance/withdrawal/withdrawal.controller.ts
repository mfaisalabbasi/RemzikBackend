import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Patch,
  Param,
} from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.gaurd';

@UseGuards(JwtAuthGuard)
@Controller('finance/withdrawals')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Post('request')
  async request(
    @Req() req,
    @Body() dto: { amount: number; iban: string; bankName: string },
  ) {
    return this.withdrawalService.request(req.user.userId, dto.amount, dto);
  }

  @Patch('approve/:id') // For Faisal/Admin use
  async approve(@Req() req, @Param('id') id: string) {
    return this.withdrawalService.approve(id, req.user.userId);
  }
}
