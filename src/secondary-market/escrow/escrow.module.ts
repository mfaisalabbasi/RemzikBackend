import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Escrow } from './escrow.entity';
import { EscrowService } from './escrow.service';
import { WalletModule } from 'src/wallet/wallet.module';
import { LedgerModule } from 'src/ledger/ledger.module';

@Module({
  imports: [TypeOrmModule.forFeature([Escrow]), WalletModule, LedgerModule],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
