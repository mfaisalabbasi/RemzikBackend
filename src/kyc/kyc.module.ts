import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KycProfile } from './kyc.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';

import { User } from '../user/user.entity';
import { StorageModule } from 'src/storage/storage.module';
import { KycGuard } from 'src/auth/guards/kyc.guard';
import { PartnerProfile } from 'src/partner/partner.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KycProfile, User, PartnerProfile]),
    StorageModule,
  ],
  controllers: [KycController],
  providers: [KycService, KycGuard],
  // Exporting TypeOrmModule makes KycProfile and User repositories
  // available to any module that imports KycModule.
  exports: [KycService, KycGuard, TypeOrmModule],
})
export class KycModule {}
