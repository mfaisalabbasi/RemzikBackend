import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Withdrawal } from './withdrawal/withdrawal.entity';
import { Deposit } from './deposite/deposit.entity';
import { WithdrawalService } from './withdrawal/withdrawal.service';
import { WithdrawalController } from './withdrawal/withdrawal.controller';
import { DepositService } from './deposite/deposit.service';
import { DepositController } from './deposite/deposit.controller';
import { WalletModule } from '../wallet/wallet.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Withdrawal, Deposit]),
    WalletModule,
    AuditModule,
  ],
  providers: [WithdrawalService, DepositService],
  controllers: [WithdrawalController, DepositController],
  exports: [WithdrawalService, DepositService],
})
export class FinanceModule {}
