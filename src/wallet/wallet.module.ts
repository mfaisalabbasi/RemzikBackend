import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutModule } from 'src/payout/payout.module';
import { Wallet } from './wallet.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet]), LedgerModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
