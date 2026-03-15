import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';

import { PartnerProfile } from '../partner/partner.entity';
import { KycProfile } from '../kyc/kyc.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Asset,
      PartnerProfile,
      KycProfile, // ⭐ ADD THIS
    ]),
  ],
  providers: [AssetService],
  controllers: [AssetController],
  exports: [AssetService],
})
export class AssetModule {}
