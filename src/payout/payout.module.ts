import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payout } from './payout.entity';
import { PayoutService } from './payout.service';
import { WalletModule } from '../wallet/wallet.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payout]), // ✅ Provides PayoutRepository
    forwardRef(() => WalletModule), // if WalletModule imports PayoutModule
    forwardRef(() => LedgerModule),
  ],
  providers: [PayoutService],
  exports: [PayoutService],
})
export class PayoutModule {}
