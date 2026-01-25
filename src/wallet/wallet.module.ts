import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutModule } from 'src/payout/payout.module';

@Module({
  imports: [LedgerModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
