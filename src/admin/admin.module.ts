import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycProfile } from 'src/kyc/kyc.entity';
import { PartnerProfile } from 'src/partner/partner.entity';
import { Asset } from 'src/asset/asset.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycProfile, PartnerProfile, Asset])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
