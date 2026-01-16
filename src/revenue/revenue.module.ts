import { Ownership } from 'src/tokenization/entities/ownershipt.entity';
import { Payout } from './entities/payout.entity';
import { Revenue } from './entities/revenue.entity';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

@Module({
  imports: [TypeOrmModule.forFeature([Revenue, Payout, Ownership])],
  controllers: [RevenueController],
  providers: [RevenueService],
})
export class RevenueModule {}
