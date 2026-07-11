import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { ethers } from 'ethers';
import { Mutex } from 'async-mutex';
import { Dispute } from './dispute.entity';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeStatus, DisputeType } from './dispute.enums';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { EscrowService } from '../escrow/escrow.service';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { OwnershipService } from '../ownership/ownership.service';
import { Trade } from '../secondary-market/trade/trade.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { TradeStatus } from 'src/secondary-market/trade/enums/trade-status.enum';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);
  private readonly disputeMutex = new Mutex();

  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly escrowService: EscrowService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly ownershipService: OwnershipService,
    private readonly blockchainService: BlockchainService,
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
          await this.escrowService.disputeEscrow(dto.referenceId, manager);
          await manager.update(Trade, dto.referenceId, {
            status: 'DISPUTED' as any,
          });
        } catch (e: unknown) {
          throw new BadRequestException(
            `Financial link failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
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

  async resolveDispute(
    disputeId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ) {
    // Lock critical resolution path to prevent concurrent non-deterministic states
    return await this.disputeMutex.runExclusive(async () => {
      const dispute = await this.disputeRepo.findOne({
        where: { id: disputeId },
      });
      if (!dispute) throw new NotFoundException('Dispute record not found');

      if (
        [
          DisputeStatus.RESOLVED_FAVOR_BUYER,
          DisputeStatus.RESOLVED_FAVOR_SELLER,
          DisputeStatus.REJECTED,
        ].includes(dispute.status)
      ) {
        throw new BadRequestException(
          'Dispute has already reached a terminal state',
        );
      }

      return await this.dataSource.transaction(async (manager) => {
        let txHash: string | null = null;

        if (
          dto.status === DisputeStatus.RESOLVED_FAVOR_SELLER &&
          (dispute.type === DisputeType.TRADE ||
            dispute.type === DisputeType.SECONDARY_TRADE)
        ) {
          const trade = await manager.getRepository(Trade).findOne({
            where: { id: dispute.referenceId },
            relations: [
              'seller',
              'seller.user',
              'buyer',
              'buyer.user',
              'asset',
            ],
          });

          const sellerAddr = trade?.seller.user?.walletAddress;
          const buyerAddr = trade?.buyer.user?.walletAddress;

          if (!sellerAddr || !buyerAddr) {
            throw new BadRequestException(
              'Trade participants lack valid wallet addresses.',
            );
          }

          const priceString = ethers
            .parseUnits(trade!.totalPrice.toString(), 18)
            .toString();

          const receipt = await this.blockchainService.settleTrade(
            String(trade!.listingId),
            sellerAddr,
            buyerAddr,
            priceString,
          );
          txHash = receipt.hash;
        }

        if (
          dispute.type === DisputeType.TRADE ||
          dispute.type === DisputeType.SECONDARY_TRADE
        ) {
          await this.handleFinancialResolution(
            dispute.referenceId,
            dto.status,
            manager,
            txHash || undefined,
          );
        }

        dispute.status = dto.status;
        dispute.adminNote = dto.adminNote;
        dispute.adminId = adminId;
        dispute.resolvedAt = new Date();
        const updatedDispute = await manager.save(dispute);

        if (
          dto.status === DisputeStatus.RESOLVED_FAVOR_SELLER ||
          dto.status === DisputeStatus.RESOLVED_FAVOR_BUYER
        ) {
          await manager.update(Trade, dispute.referenceId, {
            status: TradeStatus.COMPLETED as any,
            ...(txHash && { txHash }),
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
    });
  }

  private async handleFinancialResolution(
    referenceId: string,
    targetStatus: DisputeStatus,
    manager: EntityManager,
    txHash?: string,
  ) {
    const trade = await manager.getRepository(Trade).findOne({
      where: { id: referenceId },
      relations: ['buyer', 'buyer.user', 'seller', 'seller.user', 'asset'],
    });

    if (!trade) throw new BadRequestException('Trade not found');

    switch (targetStatus) {
      case DisputeStatus.RESOLVED_FAVOR_BUYER:
        await this.escrowService.refundEscrowByTradeId(referenceId, manager);
        break;

      case DisputeStatus.FROZEN:
        await this.escrowService.freezeEscrow(referenceId, manager);
        break;

      case DisputeStatus.RESOLVED_FAVOR_SELLER:
        if (!txHash)
          throw new BadRequestException('Missing blockchain transaction hash.');

        const receipt = await this.blockchainService
          .getProvider()
          .getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) {
          throw new InternalServerErrorException(
            'Transaction not found or failed on-chain.',
          );
        }

        await this.escrowService.releaseEscrowByTradeId(referenceId, manager);
        await this.ownershipService.removeUnits(
          trade.seller.id,
          trade.asset.id,
          trade.units,
          manager,
        );
        await this.ownershipService.addUnits(
          trade.buyer.id,
          trade.asset.id,
          trade.units,
          manager,
        );

        await manager.update(Trade, referenceId, {
          txHash,
          status: TradeStatus.COMPLETED,
        });
        break;

      default:
        throw new BadRequestException('Invalid resolution status');
    }
  }

  async getUserDisputes(userId: string): Promise<Dispute[]> {
    return await this.disputeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      relations: ['trade'],
    });
  }

  async getAllDisputes(): Promise<Dispute[]> {
    return await this.disputeRepo.find({
      order: { createdAt: 'DESC' },
      relations: ['trade'],
    });
  }
}
