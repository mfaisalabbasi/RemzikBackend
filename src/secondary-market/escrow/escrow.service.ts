import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Escrow } from './escrow.entity';
import { EscrowStatus } from './enums/escrow-status.enum';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { AuditService } from 'src/audit/audit.service';
// 🛡️ Ensure this points to your unified Enum file
import { AdminAction } from 'src/audit/enums/audit-action.enum';

@Injectable()
export class EscrowService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * LOCK FUNDS IN ESCROW
   */
  async createEscrow({
    tradeId,
    buyerId,
    sellerId,
    amount,
    lockDays = 1,
  }: {
    tradeId: string;
    buyerId: string;
    sellerId: string;
    amount: number;
    lockDays?: number;
  }) {
    const releaseAt = new Date();
    releaseAt.setDate(releaseAt.getDate() + lockDays);

    const escrow = this.escrowRepo.create({
      tradeId,
      buyerId,
      sellerId,
      amount,
      releaseAt,
      status: EscrowStatus.LOCKED,
    });

    await this.ledgerService.record({
      userId: sellerId,
      amount: -amount,
      type: LedgerType.ESCROW_LOCK,
      source: LedgerSource.SECONDARY_MARKET_SELL,
      reference: tradeId,
      description: `Funds from trade ${tradeId} locked in escrow`,
    });

    const savedEscrow = await this.escrowRepo.save(escrow);

    // ✅ AUDIT: Log Escrow Lock using the Enum
    await this.auditService.log({
      adminId: buyerId, // The actor who triggered the lock
      targetId: savedEscrow.id,
      action: AdminAction.ESCROW_LOCKED,
      reason: `Funds locked for trade: ${tradeId}`,
    });

    return savedEscrow;
  }

  /**
   * RELEASE FUNDS TO SELLER
   */
  async releaseEscrow(escrowId: string) {
    const escrow = await this.escrowRepo.findOne({ where: { id: escrowId } });

    if (!escrow) throw new NotFoundException('Escrow record not found');
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(
        `Cannot release escrow with status: ${escrow.status}`,
      );
    }

    escrow.status = EscrowStatus.RELEASED;
    await this.escrowRepo.save(escrow);

    await this.walletService.unlockFunds(escrow.sellerId, escrow.amount);

    await this.ledgerService.record({
      userId: escrow.sellerId,
      amount: escrow.amount,
      type: LedgerType.ESCROW_RELEASE,
      reference: escrow.tradeId,
      source: LedgerSource.SECONDARY_MARKET_SELL,
      description: 'Escrow released to wallet',
    });

    // ✅ AUDIT: Log Escrow Release using the Enum
    await this.auditService.log({
      adminId: escrow.sellerId,
      targetId: escrowId,
      action: AdminAction.ESCROW_RELEASED,
      reason: `Escrow released successfully for trade: ${escrow.tradeId}`,
    });

    return escrow;
  }

  /**
   * DISPUTE ESCROW
   */
  async disputeEscrow(escrowId: string) {
    const escrow = await this.escrowRepo.findOne({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundException('Escrow not found');

    escrow.status = EscrowStatus.DISPUTED;
    const updated = await this.escrowRepo.save(escrow);

    // ✅ AUDIT: Log Escrow Dispute using the Enum
    await this.auditService.log({
      adminId: 'SYSTEM', // System-level action
      targetId: escrowId,
      action: AdminAction.ESCROW_DISPUTED,
      reason: 'Escrow marked as disputed due to trade challenge',
    });

    return updated;
  }

  async getReadyToRelease() {
    return this.escrowRepo
      .createQueryBuilder('escrow')
      .where('escrow.status = :status', { status: EscrowStatus.LOCKED })
      .andWhere('escrow.releaseAt <= :now', { now: new Date() })
      .getMany();
  }
}
