import { Module } from '@nestjs/common';
import { AssetModule } from 'src/asset/asset.module';
import { InvestmentModule } from 'src/investment/investment.module';
import { LedgerModule } from 'src/ledger/ledger.module';
import { OwnershipModule } from 'src/ownership/ownership.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PartnerModule } from 'src/partner/partner.module';
import { FinanceModule } from 'src/finance/finance.module';

@Module({
  imports: [
    AssetModule,
    InvestmentModule,
    OwnershipModule,
    LedgerModule,
    FinanceModule,
    PartnerModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
