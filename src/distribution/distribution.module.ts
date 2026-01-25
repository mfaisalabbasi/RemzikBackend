import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Distribution } from './distribution.entity';
import { DistributionService } from './distribution.service';
import { Ownership } from '../ownership/ownership.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Distribution, Ownership])],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
