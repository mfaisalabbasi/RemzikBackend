import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ownership } from './ownership.entity';
import { OwnershipService } from './ownership.service';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from 'src/asset/asset.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ownership,
      InvestorProfile, // ✅ REQUIRED
      Asset,
    ]),
  ],
  providers: [OwnershipService],
  exports: [OwnershipService, TypeOrmModule],
})
export class OwnershipModule {}
