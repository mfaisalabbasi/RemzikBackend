import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from './dispute.entity';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeStatus, DisputeType } from './dispute.enums';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { EscrowService } from '../escrow/escrow.service';
import { AuditService } from 'src/audit/audit.service';
// 🛡️ Ensure this points to your unified Enum file
import { AdminAction } from 'src/audit/enums/audit-action.enum';

@Injectable()
export class DisputeService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly escrowService: EscrowService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * CREATE DISPUTE
   * Automatically freezes Escrow if it's a trade dispute.
   */
  async createDispute(userId: string, dto: CreateDisputeDto) {
    const dispute = this.disputeRepo.create({
      userId,
      ...dto,
      status: DisputeStatus.OPEN,
    });

    const savedDispute = await this.disputeRepo.save(dispute);

    // 🛡️ SECURITY: Freeze escrow funds if applicable
    if (
      dto.type === DisputeType.TRADE ||
      dto.type === DisputeType.SECONDARY_TRADE
    ) {
      try {
        await this.escrowService.disputeEscrow(dto.referenceId);
      } catch (e) {
        // Log locally if escrow isn't found, but allow dispute to proceed
      }
    }

    // 📝 AUDIT: Record that a user has opened a dispute
    await this.auditService.log({
      adminId: userId, // Mapping to your AuditLog 'adminId' column (the actor)
      targetId: savedDispute.id,
      action: AdminAction.DISPUTE_OPENED,
      reason: `User opened a ${dto.type} dispute for ref: ${dto.referenceId}`,
    });

    return savedDispute;
  }

  /**
   * RESOLVE DISPUTE
   * Handled by Faisal (Admin) to finalize the outcome.
   */
  async resolveDispute(
    disputeId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ) {
    const dispute = await this.getById(disputeId);

    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Dispute already handled');
    }

    dispute.status = dto.status;
    dispute.adminNote = dto.adminNote;
    dispute.adminId = adminId;
    dispute.resolvedAt = new Date();

    const result = await this.disputeRepo.save(dispute);

    // 🛡️ DYNAMIC AUDIT: Matches 'DISPUTE_RESOLVED' or 'DISPUTE_REJECTED'
    // We use bracket notation to safely access the Enum key
    const dynamicActionKey =
      `DISPUTE_${dto.status}` as keyof typeof AdminAction;
    const action =
      AdminAction[dynamicActionKey] || AdminAction.DISPUTE_RESOLVED;

    await this.auditService.log({
      adminId: adminId,
      targetId: disputeId,
      action: action,
      reason: dto.adminNote || 'Dispute status updated by admin',
    });

    return result;
  }

  // Helper Methods
  async getUserDisputes(userId: string) {
    return this.disputeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getAllDisputes() {
    return this.disputeRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getById(id: string) {
    const dispute = await this.disputeRepo.findOne({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }
}
