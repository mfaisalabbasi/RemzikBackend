import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';

import { PartnerProfile } from '../partner/partner.entity';
import { KycProfile } from '../kyc/kyc.entity';
import { StorageModule } from '../../src/storage/storage.module';
import { Investment } from 'src/investment/investment.entity';
import { User } from 'src/user/user.entity';
import { AssetIncome } from './asset-income.entity';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Asset,
      PartnerProfile,
      KycProfile,
      Investment,
      User,
      AssetIncome,
    ]),
    StorageModule,
  ],
  providers: [AssetService, IncomeService],
  controllers: [AssetController, IncomeController],
  exports: [AssetService, IncomeService, TypeOrmModule], // Exporting TypeOrmModule allows other modules to use AssetIncome
})
export class AssetModule {}
