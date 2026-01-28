import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Withdrawal } from './withdrawal.entity';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalController } from './withdrawal.controller';
import { WalletModule } from 'src/wallet/wallet.module';
import { LedgerModule } from 'src/ledger/ledger.module';

@Module({
  imports: [TypeOrmModule.forFeature([Withdrawal]), WalletModule, LedgerModule],
  providers: [WithdrawalService],
  controllers: [WithdrawalController],
})
export class WithdrawalModule {}
