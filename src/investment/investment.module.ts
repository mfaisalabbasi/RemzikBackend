import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investment } from './investment.entity';
import { InvestmentService } from './investment.service';
import { InvestmentController } from './investment.controller';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { KycModule } from 'src/kyc/kyc.module';

@Module({
  imports: [
    KycModule,
    TypeOrmModule.forFeature([Investment, InvestorProfile, Asset]),
  ],
  providers: [InvestmentService],
  controllers: [InvestmentController],
})
export class InvestmentModule {}
