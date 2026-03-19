import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerProfile } from './partner.entity';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';
import { Asset } from 'src/asset/asset.entity';
import { StorageModule } from '../storage/storage.module';
@Module({
  imports: [TypeOrmModule.forFeature([PartnerProfile, Asset]), StorageModule],
  providers: [PartnerService],
  controllers: [PartnerController],
  exports: [PartnerService],
})
export class PartnerModule {}
