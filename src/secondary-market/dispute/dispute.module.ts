import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './dispute.entity';
import { DisputeService } from './dispute.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dispute])],
  providers: [DisputeService],
  exports: [DisputeService, TypeOrmModule],
})
export class DisputeModule {}
