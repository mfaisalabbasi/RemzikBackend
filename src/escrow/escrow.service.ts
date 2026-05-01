import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm'; // Added DataSource
import { Escrow } from './escrow.entity';
import { EscrowStatus } from './enums/escrow-status.enum';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';

@Injectable()
export class EscrowService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * LOCK FUNDS: The start of a trade.
   * Buyer's money is moved to a 'Frozen' state.
   */
  async createEscrow(
    data: {
      tradeId: string;
      buyerId: string;
      sellerId: string;
      amount: number;
      lockDays?: number;
    },
    manager?: EntityManager,
  ) {
    const work = async (em: EntityManager) => {
      const releaseAt = new Date();
      releaseAt.setDate(releaseAt.getDate() + (data.lockDays || 1));

      // 1. Create Record
      const escrow = em.create(Escrow, {
        ...data,
        releaseAt,
        status: EscrowStatus.LOCKED,
      });

      // 2. Lock Wallet Funds (Moves Available -> Locked)
      // This is the most critical financial step.
      await this.walletService.lockFunds(data.buyerId, data.amount, em);

      // 3. Record Ledger (Showing the lock for transparency)
      await this.ledgerService.record(
        {
          userId: data.buyerId,
          amount: -data.amount,
          type: LedgerType.ESCROW_LOCK,
          source: LedgerSource.SECONDARY_MARKET_TRADE,
          reference: data.tradeId,
          description: `Funds locked for secondary trade ${data.tradeId}`,
        },
        em,
      );

      const saved = await em.save(escrow);

      // 4. Audit
      await this.auditService.log(
        {
          adminId: data.buyerId,
          targetId: saved.id,
          action: AdminAction.ESCROW_LOCKED,
          reason: `Trade ${data.tradeId} initiated. Funds frozen.`,
        },
        em,
      );

      return saved;
    };

    return manager ? work(manager) : this.dataSource.transaction(work);
  }

  /**
   * RELEASE: The "Happy Path" resolution.
   * Money moves from Buyer's Locked state to Seller's Available state.
   */
  async releaseEscrow(escrowId: string, manager?: EntityManager) {
    const work = async (em: EntityManager) => {
      const repo = em.getRepository(Escrow);
      const escrow = await repo.findOne({ where: { id: escrowId } });

      if (!escrow) throw new NotFoundException('Escrow not found');
      if (escrow.status !== EscrowStatus.LOCKED) {
        throw new BadRequestException(`Cannot release from ${escrow.status}`);
      }

      // 1. Update Status
      escrow.status = EscrowStatus.RELEASED;
      await em.save(escrow);

      // 2. Finalize Transfer: Buyer Locked -> Seller Available
      await this.walletService.transferLockedToAvailable(
        escrow.buyerId,
        escrow.sellerId,
        escrow.amount,
        em,
      );

      // 3. Ledger Entries (Dual entry for audit compliance)
      await this.ledgerService.record(
        {
          userId: escrow.sellerId,
          amount: escrow.amount,
          type: LedgerType.ESCROW_RELEASE,
          reference: escrow.tradeId,
          source: LedgerSource.SECONDARY_MARKET_TRADE,
          description: 'Funds received from escrow trade',
        },
        em,
      );

      // 4. Audit
      await this.auditService.log(
        {
          adminId: 'SYSTEM',
          targetId: escrow.id,
          action: AdminAction.ESCROW_RELEASED,
          reason: `Escrow release completed for trade ${escrow.tradeId}`,
        },
        em,
      );

      return escrow;
    };

    return manager ? work(manager) : this.dataSource.transaction(work);
  }

  /**
   * DISPUTE: Triggered by DisputeService.
   * Just flips the status to prevent accidental auto-release.
   */
  async disputeEscrow(tradeId: string, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(Escrow) : this.escrowRepo;
    const escrow = await repo.findOne({ where: { tradeId } });

    if (!escrow) throw new NotFoundException('Escrow not found for trade');

    escrow.status = EscrowStatus.DISPUTED;
    return await repo.save(escrow);
  }

  async getReadyToRelease() {
    return this.escrowRepo
      .createQueryBuilder('escrow')
      .where('escrow.status = :status', { status: EscrowStatus.LOCKED })
      .andWhere('escrow.releaseAt <= :now', { now: new Date() })
      .getMany();
  }
}
