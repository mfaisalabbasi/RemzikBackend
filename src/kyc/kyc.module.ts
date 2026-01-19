import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycProfile } from './kyc.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { User } from '../user/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KycProfile, User])],
  controllers: [KycController],
  providers: [KycService],
  exports: [TypeOrmModule],
})
export class KycModule {}
