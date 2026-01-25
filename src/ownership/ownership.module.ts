import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ownership } from './ownership.entity';
import { OwnershipService } from './ownership.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ownership])],
  providers: [OwnershipService],
  exports: [OwnershipService, TypeOrmModule],
})
export class OwnershipModule {}
