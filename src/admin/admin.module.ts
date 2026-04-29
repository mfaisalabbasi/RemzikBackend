import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PartnerModule } from 'src/partner/partner.module';
import { AssetModule } from 'src/asset/asset.module';
import { AuditModule } from 'src/audit/audit.module';
import { KycModule } from 'src/kyc/kyc.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { BroadcastModule } from 'src/broadcast/broadcast.module';
import { InvestorModule } from 'src/investor/investor.module';
import { InvestmentModule } from 'src/investment/investment.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Investment } from 'src/investment/investment.entity';
import { Trade } from 'src/secondary-market/trade/trade.entity';
import { Wallet } from 'src/wallet/wallet.entity';
import { LedgerModule } from 'src/ledger/ledger.module';
import { KycProfile } from 'src/kyc/kyc.entity';
import { PartnerProfile } from 'src/partner/partner.entity';
import { Asset } from 'src/asset/asset.entity';
import { AuditLog } from 'src/audit/audit.entity';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
  imports: [
    TypeOrmModule.forFeature([
      InvestorProfile,
      Investment,
      Trade,
      Wallet,
      KycProfile,
      PartnerProfile,
      Asset,
      AuditLog,
    ]),
    PartnerModule,
    AssetModule,
    AuditModule,
    KycModule,
    WalletModule,
    BroadcastModule,
    InvestorModule,
    InvestmentModule,
    LedgerModule,
  ],
})
export class AdminModule {}
