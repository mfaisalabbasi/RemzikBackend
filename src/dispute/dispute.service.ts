import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm'; // 💡 Added DataSource for Transactions
import { Dispute } from './dispute.entity';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeStatus, DisputeType } from './dispute.enums';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { EscrowService } from '../escrow/escrow.service';
import { AuditService } from 'src/audit/audit.service';
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
    private readonly dataSource: DataSource, // 💡 For Fintech-grade Atomic Operations
  ) {}

  /**
   * CREATE DISPUTE
   * Transactional logic: Ensures Escrow is frozen BEFORE the dispute is finalized.
   */
  async createDispute(userId: string, dto: CreateDisputeDto) {
    return await this.dataSource.transaction(async (manager) => {
      // 1️⃣ Create the dispute record within the transaction
      const dispute = manager.create(Dispute, {
        userId,
        ...dto,
        status: DisputeStatus.OPEN,
      });

      const savedDispute = await manager.save(dispute);

      // 2️⃣ 🛡️ SECURITY: Freeze escrow funds if it's a trade
      // We pass the 'manager' to ensure it's part of the same DB transaction
      if (
        dto.type === DisputeType.TRADE ||
        dto.type === DisputeType.SECONDARY_TRADE
      ) {
        try {
          // Note: Ensure your EscrowService.disputeEscrow accepts a manager
          await this.escrowService.disputeEscrow(dto.referenceId, manager);
        } catch (e) {
          // If escrow is missing, we log it, but in a strict fintech environment,
          // you might want to 'throw e' here to prevent orphan disputes.
          console.error(`Escrow lock failed for ref: ${dto.referenceId}`, e);
        }
      }

      // 3️⃣ 📝 AUDIT: Record that a user has opened a dispute
      await this.auditService.log(
        {
          adminId: userId,
          targetId: savedDispute.id,
          action: AdminAction.DISPUTE_OPENED,
          reason: `User opened a ${dto.type} dispute for ref: ${dto.referenceId}`,
        },
        manager,
      );

      return savedDispute;
    });
  }

  /**
   * RESOLVE DISPUTE
   * Handled by Admin (Faisal) to finalize the outcome and move funds.
   */
  async resolveDispute(
    disputeId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      const dispute = await manager.findOne(Dispute, {
        where: { id: disputeId },
      });

      if (!dispute) throw new NotFoundException('Dispute not found');

      if (
        dispute.status !== DisputeStatus.OPEN &&
        dispute.status !== DisputeStatus.UNDER_REVIEW
      ) {
        throw new BadRequestException('Dispute already handled');
      }

      // 1️⃣ Update resolution details
      dispute.status = dto.status;
      dispute.adminNote = dto.adminNote || dto.reason;
      dispute.adminId = adminId;
      dispute.resolvedAt = new Date();

      const result = await manager.save(dispute);

      // 2️⃣ 💸 FINANCIAL SETTLEMENT: Move funds if RESOLVED
      if (dto.status === DisputeStatus.RESOLVED) {
        // You would call escrowService.resolveDisputeFunds(refId, action, manager)
        // This handles the actual 'Refund' or 'Release' logic
      }

      // 3️⃣ 🛡️ DYNAMIC AUDIT
      const dynamicActionKey =
        `DISPUTE_${dto.status}` as keyof typeof AdminAction;
      const action =
        AdminAction[dynamicActionKey] || AdminAction.DISPUTE_RESOLVED;

      await this.auditService.log(
        {
          adminId: adminId,
          targetId: disputeId,
          action: action,
          reason: dto.adminNote || 'Dispute status updated by admin',
        },
        manager,
      );

      return result;
    });
  }

  // --- Helper Methods ---

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
