import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investment } from './investment.entity';
import { InvestmentService } from './investment.service';
import { InvestmentController } from './investment.controller';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { KycModule } from 'src/kyc/kyc.module';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { OwnershipModule } from 'src/ownership/ownership.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    KycModule,
    TypeOrmModule.forFeature([Investment, InvestorProfile, Asset, AssetToken]),
    OwnershipModule,
    WalletModule,
    // ✅ Use .forRoot() to initialize the provider for the InvestmentService
    EventEmitterModule.forRoot(),
    NotificationsModule,
  ],
  providers: [InvestmentService, NotificationOrchestrator],
  controllers: [InvestmentController],
  exports: [InvestmentService, NotificationOrchestrator],
})
export class InvestmentModule {}
