import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycProfile } from 'src/kyc/kyc.entity';
import { PartnerProfile } from 'src/partner/partner.entity';
import { Asset } from 'src/asset/asset.entity';
import { AdminActionDto } from './dto/admin-action.dto';
import { AdminAction } from './enums/admin-action.enum';
import { KycStatus } from 'src/kyc/enums/kyc-status.enum';
import { PartnerStatus } from 'src/partner/enums/partner-status.enum';
import { AssetStatus } from 'src/asset/enums/asset-status.enum';
import { AuditService } from 'src/audit/audit.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(KycProfile)
    private kycRepo: Repository<KycProfile>,

    @InjectRepository(PartnerProfile)
    private partnerRepo: Repository<PartnerProfile>,

    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,
    private readonly auditService: AuditService,
  ) {}

  //Moderate kyc

  async moderateKyc(kycId: string, dto: AdminActionDto) {
    const kyc = await this.kycRepo.findOne({ where: { id: kycId } });

    if (!kyc) throw new NotFoundException('KYC not found');

    if (dto.action === AdminAction.APPROVE) {
      kyc.status = KycStatus.APPROVED;
    }

    if (dto.action === AdminAction.REJECT) {
      if (!dto.reason)
        throw new BadRequestException('Rejection reason required');

      kyc.status = KycStatus.REJECTED;
      // kyc.rejectionReason = dto.reason;
    }

    return this.kycRepo.save(kyc);
  }

  //   await this.auditService.log(
  //   adminId,
  //   'kyc',
  //   kyc.id,
  //   dto.action === AdminAction.APPROVE
  //     ? AuditAction.KYC_APPROVED
  //     : AuditAction.KYC_REJECTED,
  //   dto.reason,
  // );

  // Modrate Partner

  async moderatePartner(partnerId: string, dto: AdminActionDto) {
    const partner = await this.partnerRepo.findOne({
      where: { id: partnerId },
    });

    if (!partner) throw new NotFoundException('Partner not found');

    if (dto.action === AdminAction.APPROVE) {
      partner.status = PartnerStatus.APPROVED;
    }

    if (dto.action === AdminAction.REJECT) {
      partner.status = PartnerStatus.REJECTED;
      // partner.rejectionReason = dto.reason;
    }

    return this.partnerRepo.save(partner);
  }

  //   await this.auditService.log(
  //   adminId,
  //   'partner',
  //   partner.id,
  //   dto.action === AdminAction.APPROVE
  //     ? AuditAction.PARTNER_APPROVED
  //     : AuditAction.PARTNER_REJECTED,
  //   dto.reason,
  // );

  // Moderate Assets

  async moderateAsset(assetId: string, dto: AdminActionDto) {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset) throw new NotFoundException('Asset not found');

    if (dto.action === AdminAction.APPROVE) {
      asset.status = AssetStatus.APPROVED;
    }

    if (dto.action === AdminAction.REJECT) {
      asset.status = AssetStatus.REJECTED;
      // asset.rejectionReason = dto.reason;
    }

    return this.assetRepo.save(asset);
  }
}
// await this.auditService.log(
//   adminId,
//   'asset',
//   asset.id,
//   dto.action === AdminAction.APPROVE
//     ? AuditAction.ASSET_APPROVED
//     : AuditAction.ASSET_REJECTED,
//   dto.reason,
// );
