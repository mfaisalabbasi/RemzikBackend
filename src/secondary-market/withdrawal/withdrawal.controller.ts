import { Controller, Post, Body, Patch, Param } from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';

@Controller('withdrawals')
export class WithdrawalController {
  constructor(private readonly service: WithdrawalService) {}

  @Post()
  request(@Body() body) {
    return this.service.requestWithdrawal(body);
  }

  // ADMIN ONLY
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.service.approveWithdrawal(id);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string) {
    return this.service.rejectWithdrawal(id);
  }

  @Patch(':id/paid')
  paid(@Param('id') id: string) {
    return this.service.markAsPaid(id);
  }
}
