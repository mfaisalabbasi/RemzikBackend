import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Broadcast } from './broadcast.entity';
import { BroadcastService } from './broadcast.service';
import { BroadcastGateway } from './broadcast.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Broadcast])],
  providers: [BroadcastService, BroadcastGateway],
  exports: [BroadcastService, TypeOrmModule],
})
export class BroadcastModule {}
