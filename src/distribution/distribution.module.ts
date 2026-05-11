import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DistributionService } from './distribution.service';
import { DistributionController } from './distribution.controller';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { Investment } from 'src/investment/investment.entity';
import { AssetIncome } from 'src/asset/asset-income.entity';
import { WalletModule } from 'src/wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Distribution,
      Ownership,
      Investment,
      AssetIncome,
    ]),
    WalletModule,
  ],
  controllers: [DistributionController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
