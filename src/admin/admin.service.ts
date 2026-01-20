// src/admin/admin.service.ts
import { Injectable } from '@nestjs/common';
import { PartnerService } from 'src/partner/partner.service';
import { AssetService } from 'src/asset/asset.service';
import { KycService } from 'src/kyc/kyc.service';
import { AuditService } from 'src/audit/audit.service';
import { AdminActionDto } from './dto/admin-action.dto';
import { AdminAction } from './enums/admin-action.enum';

@Injectable()
export class AdminService {
  constructor(
    private readonly partnerService: PartnerService,
    private readonly assetService: AssetService,
    private readonly kycService: KycService,
    private readonly auditService: AuditService,
  ) {}

  async handlePartnerAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE) {
      await this.partnerService.approve(dto.targetId);
    } else if (dto.action === AdminAction.REJECT) {
      await this.partnerService.reject(dto.targetId, dto.reason);
    }

    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  async handleAssetAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE) {
      await this.assetService.approve(dto.targetId);
    } else if (dto.action === AdminAction.FREEZE) {
      await this.assetService.freeze(dto.targetId);
    }

    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  async handleKycAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE) {
      await this.kycService.approve(dto.targetId);
    } else if (dto.action === AdminAction.REJECT) {
      await this.kycService.reject(dto.targetId, dto.reason);
    }

    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }
}
