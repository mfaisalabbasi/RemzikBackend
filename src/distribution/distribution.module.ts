import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Distribution } from './distribution.entity';
import { DistributionService } from './distribution.service';
import { Ownership } from '../ownership/ownership.entity';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Distribution, Ownership, AssetToken])],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
