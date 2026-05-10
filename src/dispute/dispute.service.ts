import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Dispute } from './dispute.entity';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeStatus, DisputeType } from './dispute.enums';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { EscrowService } from '../escrow/escrow.service';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { Escrow } from '../escrow/escrow.entity';
import { OwnershipService } from '../ownership/ownership.service';
import { Trade } from '../secondary-market/trade/trade.entity';

@Injectable()
export class DisputeService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    private readonly escrowService: EscrowService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly ownershipService: OwnershipService,
  ) {}

  async createDispute(userId: string, dto: CreateDisputeDto) {
    return await this.dataSource.transaction(async (manager) => {
      const existingDispute = await manager.findOne(Dispute, {
        where: { referenceId: dto.referenceId },
      });

      if (existingDispute) {
        throw new BadRequestException(
          `Arbitration already exists for this transaction (Status: ${existingDispute.status}).`,
        );
      }

      const dispute = manager.create(Dispute, {
        userId,
        referenceId: dto.referenceId,
        type: dto.type,
        reason: dto.reason,
        status: DisputeStatus.OPEN,
      });

      const savedDispute = await manager.save(dispute);

      if (
        dto.type === DisputeType.TRADE ||
        dto.type === DisputeType.SECONDARY_TRADE
      ) {
        try {
          // 1. Handle Escrow Logic (Money Freeze)
          await this.escrowService.disputeEscrow(dto.referenceId, manager);

          // 2. Update Trade Status to DISPUTED to sync with Frontend
          // Ensure your 'trades_status_enum' in DB has 'DISPUTED'
          await manager.update(Trade, dto.referenceId, {
            status: 'DISPUTED' as any,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          throw new BadRequestException(
            `Financial link failed: Trade ${dto.referenceId} update error: ${msg}`,
          );
        }
      }

      await this.auditService.log(
        {
          adminId: userId,
          targetId: savedDispute.id,
          action: AdminAction.DISPUTE_OPENED,
          reason: `System-level freeze initiated for ${dto.type} ID: ${dto.referenceId}`,
        },
        manager,
      );

      return savedDispute;
    });
  }

  async getAllDisputes() {
    return this.disputeRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async getUserDisputes(userId: string) {
    return this.disputeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async resolveDispute(
    disputeId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      const dispute = await manager.findOne(Dispute, {
        where: { id: disputeId },
      });

      if (!dispute) throw new NotFoundException('Dispute record not found');

      const terminalStatuses = [
        DisputeStatus.RESOLVED_FAVOR_BUYER,
        DisputeStatus.RESOLVED_FAVOR_SELLER,
        DisputeStatus.REJECTED,
      ];

      if (terminalStatuses.includes(dispute.status)) {
        throw new BadRequestException(
          'Dispute has already reached a terminal state',
        );
      }

      if (
        dispute.type === DisputeType.TRADE ||
        dispute.type === DisputeType.SECONDARY_TRADE
      ) {
        await this.handleFinancialResolution(
          dispute.referenceId,
          dto.status,
          manager,
        );
      }

      dispute.status = dto.status;
      dispute.adminNote = dto.adminNote;
      dispute.adminId = adminId;
      dispute.resolvedAt = new Date();

      const updatedDispute = await manager.save(dispute);

      // --- CRITICAL FIX FOR DB ENUM ERROR ---
      // We use 'COMPLETED' instead of 'SETTLED' to align with your Postgres trades_status_enum
      if (
        dto.status === DisputeStatus.RESOLVED_FAVOR_SELLER ||
        dto.status === DisputeStatus.RESOLVED_FAVOR_BUYER
      ) {
        await manager.update(Trade, dispute.referenceId, {
          status: 'COMPLETED' as any,
        });
      }

      await this.auditService.log(
        {
          adminId,
          targetId: disputeId,
          action: AdminAction.DISPUTE_RESOLVED,
          reason: `Resolution: ${dto.status}. Note: ${dto.adminNote}`,
        },
        manager,
      );

      return updatedDispute;
    });
  }

  private async handleFinancialResolution(
    referenceId: string,
    targetStatus: DisputeStatus,
    manager: EntityManager,
  ) {
    const escrow = await manager.getRepository(Escrow).findOne({
      where: { tradeId: referenceId },
    });

    if (!escrow) {
      throw new BadRequestException(
        `Ledger Error: No active escrow record found for trade ${referenceId}`,
      );
    }

    try {
      switch (targetStatus) {
        case DisputeStatus.RESOLVED_FAVOR_SELLER:
          await this.escrowService.releaseEscrowByTradeId(referenceId, manager);
          break;

        case DisputeStatus.RESOLVED_FAVOR_BUYER:
          await this.escrowService.refundEscrowByTradeId(referenceId, manager);

          const trade = await manager.getRepository(Trade).findOne({
            where: { id: referenceId },
            relations: ['buyer', 'seller', 'asset'],
          });

          if (!trade || !trade.buyer || !trade.seller || !trade.asset) {
            throw new BadRequestException(
              'Rollback failed: Trade relations missing.',
            );
          }

          await this.ownershipService.removeUnits(
            trade.buyer.id,
            trade.asset.id,
            trade.units,
            manager,
          );
          await this.ownershipService.addUnits(
            trade.seller,
            trade.asset.id,
            trade.units,
            manager,
          );
          break;

        case DisputeStatus.FROZEN:
          await this.escrowService.freezeEscrow(referenceId, manager);
          break;

        default:
          break;
      }
    } catch (error: any) {
      throw new BadRequestException(`Settlement failed: ${error.message}`);
    }
  }
}
