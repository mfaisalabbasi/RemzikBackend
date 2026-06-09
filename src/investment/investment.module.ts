import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Investment } from './investment.entity';
import { InvestmentService } from './investment.service';
import { InvestmentController } from './investment.controller';
import { InvestmentProcessor } from './investment.processor'; // Added
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { KycModule } from 'src/kyc/kyc.module';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { OwnershipModule } from 'src/ownership/ownership.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    KycModule,
    TypeOrmModule.forFeature([Investment, InvestorProfile, Asset, AssetToken]),
    OwnershipModule,
    WalletModule,
    EventEmitterModule.forRoot(),
    NotificationsModule,
    BullModule.registerQueue({
      name: 'investment-queue',
    }),
  ],
  providers: [InvestmentService, NotificationOrchestrator, InvestmentProcessor],
  controllers: [InvestmentController],
  exports: [InvestmentService, NotificationOrchestrator],
})
export class InvestmentModule {}
