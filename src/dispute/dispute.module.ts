import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './dispute.entity';
import { DisputeService } from './dispute.service';
import { WalletModule } from 'src/wallet/wallet.module';
import { LedgerModule } from 'src/ledger/ledger.module';
import { AuditModule } from 'src/audit/audit.module';
import { EscrowModule } from '../escrow/escrow.module';
import { DisputeController } from './dispute.controller';
import { OwnershipModule } from 'src/ownership/ownership.module';
import { Trade } from 'src/secondary-market/trade/trade.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dispute, Trade]),
    WalletModule,
    LedgerModule,
    AuditModule,
    EscrowModule,
    OwnershipModule,
  ],
  controllers: [DisputeController],
  providers: [DisputeService],
  exports: [DisputeService, TypeOrmModule],
})
export class DisputeModule {}
