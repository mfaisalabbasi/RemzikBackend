import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PartnerModule } from 'src/partner/partner.module';
import { AssetModule } from 'src/asset/asset.module';
import { AuditModule } from 'src/audit/audit.module';
import { KycModule } from 'src/kyc/kyc.module';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
  imports: [PartnerModule, AssetModule, AuditModule, KycModule],
})
export class AdminModule {}
