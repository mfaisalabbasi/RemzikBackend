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

@Module({
  imports: [
    KycModule,
    TypeOrmModule.forFeature([Investment, InvestorProfile, Asset, AssetToken]),
    OwnershipModule,
  ],
  providers: [InvestmentService],
  controllers: [InvestmentController],
})
export class InvestmentModule {}
