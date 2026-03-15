import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KycProfile } from './kyc.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';

import { User } from '../user/user.entity';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([KycProfile, User]), StorageModule],
  controllers: [KycController],
  providers: [KycService],
  // Exporting TypeOrmModule makes KycProfile and User repositories
  // available to any module that imports KycModule.
  exports: [KycService, TypeOrmModule],
})
export class KycModule {}
