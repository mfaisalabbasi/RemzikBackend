import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestorProfile } from './investor.entity';
import { InvestorService } from './investor.service';
import { InvestorController } from './investor.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InvestorProfile])],
  providers: [InvestorService],
  controllers: [InvestorController],
  exports: [InvestorService],
})
export class InvestorModule {}
