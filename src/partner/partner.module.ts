import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerProfile } from './partner.entity';
import { PartnerService } from './partner.service';
import { PartnerController } from './partner.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerProfile])],
  providers: [PartnerService],
  controllers: [PartnerController],
  exports: [PartnerService],
})
export class PartnerModule {}
