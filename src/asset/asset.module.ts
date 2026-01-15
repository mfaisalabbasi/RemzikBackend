import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { AssetController } from './asset.controller';
import { PartnerProfile } from 'src/partner/partner.entity';
import { KycModule } from 'src/kyc/kyc.module';

@Module({
  imports: [TypeOrmModule.forFeature([Asset, PartnerProfile]), KycModule],
  providers: [AssetService],
  controllers: [AssetController],
})
export class AssetModule {}
