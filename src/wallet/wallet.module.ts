import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutModule } from 'src/payout/payout.module';
import { Wallet } from './wallet.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './wallet.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet]), LedgerModule],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
