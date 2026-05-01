import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { LedgerModule } from '../ledger/ledger.module';
import { Wallet } from './wallet.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './wallet.controller';
import { FinanceModule } from 'src/finance/finance.module';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet]), LedgerModule],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
