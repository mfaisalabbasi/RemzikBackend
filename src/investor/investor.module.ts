import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestorProfile } from './investor.entity';
import { InvestorService } from './investor.service';
import { InvestorController } from './investor.controller';
import { WalletModule } from 'src/wallet/wallet.module';
import { InvestmentModule } from 'src/investment/investment.module';
import { LedgerModule } from 'src/ledger/ledger.module';
import { Ownership } from 'src/ownership/ownership.entity';
import { TradeModule } from 'src/secondary-market/trade/trade.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvestorProfile, Ownership]),
    WalletModule,
    InvestmentModule,
    LedgerModule,
    TradeModule,
  ],
  providers: [InvestorService],
  controllers: [InvestorController],
  exports: [InvestorService],
})
export class InvestorModule {}
