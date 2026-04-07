import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt.gaurd';
import { LedgerService } from 'src/ledger/ledger.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard) // Applied to the whole controller for security
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Returns the current user's wallet balances.
   */
  @Get('me')
  async getMyWallet(@Req() req) {
    return this.walletService.getWallet(req.user.userId);
  }

  /**
   * Returns the full transaction history (Ledger) for the user.
   */
  @Get('transactions')
  async getMyTransactions(@Req() req) {
    return this.ledgerService.findByUser(req.user.userId);
  }

  /**
   * DUMMY TOP-UP: Allows adding funds to the wallet for testing.
   * Future: This will be replaced by a Payment Gateway Webhook.
   */
  @Post('dummy-topup')
  async topup(@Req() req, @Body('amount') amount: number) {
    return this.walletService.topUpDummy(req.user.userId, amount);
  }
}
