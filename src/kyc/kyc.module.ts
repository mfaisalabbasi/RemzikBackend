import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycProfile } from './kyc.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KycProfile])],
  providers: [KycService],
  controllers: [KycController],
  exports: [KycService, TypeOrmModule],
})
export class KycModule {}
