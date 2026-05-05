import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DistributionService } from './distribution.service';
import { DistributionController } from './distribution.controller';
import { Investment } from 'src/investment/investment.entity'; // Path to your entity
import { WalletModule } from 'src/wallet/wallet.module'; // Import the whole module
import { LedgerModule } from 'src/ledger/ledger.module'; // Import the whole module
import { Distribution } from './distribution.entity';

@Module({
  imports: [
    // 1. Tell Nest to provide the Investment Repository here
    TypeOrmModule.forFeature([Investment, Distribution]),
    // 2. Import existing modules so their services (Wallet/Ledger) are available
    WalletModule,
    LedgerModule,
  ],
  controllers: [DistributionController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
