import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './dispute.entity';
import { DisputeService } from './dispute.service';
import { WalletModule } from 'src/wallet/wallet.module';
import { LedgerModule } from 'src/ledger/ledger.module';
import { AuditModule } from 'src/audit/audit.module';
import { EscrowModule } from '../escrow/escrow.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dispute]),
    WalletModule,
    LedgerModule,
    AuditModule,
    EscrowModule,
  ],
  providers: [DisputeService],
  exports: [DisputeService, TypeOrmModule],
})
export class DisputeModule {}
