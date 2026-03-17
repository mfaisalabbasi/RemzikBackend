import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';

import { PartnerProfile } from '../partner/partner.entity';
import { KycProfile } from '../kyc/kyc.entity';
import { StorageModule } from '../../src/storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Asset,
      PartnerProfile,
      KycProfile, // ⭐ ADD THIS
    ]),
    StorageModule,
  ],
  providers: [AssetService],
  controllers: [AssetController],
  exports: [AssetService],
})
export class AssetModule {}
