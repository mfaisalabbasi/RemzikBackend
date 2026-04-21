import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter'; // ✅ Required for @OnEvent
import { ScheduleModule } from '@nestjs/schedule';

// Modules
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NotificationsModule } from './notifications/notifications.module';

import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { PartnerModule } from './partner/partner.module';
import { AssetModule } from './asset/asset.module';
import { InvestmentModule } from './investment/investment.module';
import { KycModule } from './kyc/kyc.module';
import { InvestorModule } from './investor/investor.module';
import { DocumentModule } from './document/document.module';
import { AdminModule } from './admin/admin.module';
import { TokenizationModule } from './tokenization/tokenization.module';
import { OwnershipModule } from './ownership/ownership.module';
import { WalletModule } from './wallet/wallet.module';
import { LedgerModule } from './ledger/ledger.module';
import { PayoutModule } from './payout/payout.module';
import { SecondaryMarketModule } from './secondary-market/secondary-market.module';
import { DistributionModule } from './distribution/distribution.module';
import { StorageModule } from './storage/storage.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { BroadcastModule } from './broadcast/broadcast.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ global: true }),
    // ✅ Essential for event-based notifications
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),

    // ✅ All modules imported here, NOT inside TypeORM
    UserModule,
    AnalyticsModule,
    AuthModule,
    PartnerModule,
    AssetModule,
    InvestmentModule,
    KycModule,
    InvestorModule,
    DocumentModule,
    AdminModule,
    TokenizationModule,
    OwnershipModule,
    WalletModule,
    LedgerModule,
    SecondaryMarketModule,
    DistributionModule,
    NotificationsModule,
    StorageModule,
    AuditModule,
    BroadcastModule,
    forwardRef(() => PayoutModule),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
