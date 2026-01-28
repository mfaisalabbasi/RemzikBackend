import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { Investment } from 'src/investment/investment.entity';
import { Payout } from 'src/payout/payout.entity';
import { LedgerEntry } from 'src/ledger/ledger.entity';
import { Trade } from '../trade/trade.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Investment, Payout, LedgerEntry, Trade])],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
