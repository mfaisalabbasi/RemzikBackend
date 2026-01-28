import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Escrow } from './escrow.entity';
import { EscrowStatus } from './enums/escrow-status.enum';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
@Injectable()
export class EscrowService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly ledgersource: LedgerSource,
  ) {}

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
    });

    // Ledger: escrow lock
    await this.ledgerService.record({
      userId: sellerId,
      amount,
      type: LedgerType.ESCROW_LOCK,
      source: LedgerSource.ESCROW,
      reference: tradeId,
      description: 'Funds locked in escrow',
    });

    return this.escrowRepo.save(escrow);
  }

  async releaseEscrow(escrowId: string) {
    const escrow = await this.escrowRepo.findOneBy({ id: escrowId });

    if (!escrow) throw new ForbiddenException('Escrow not found');
    if (escrow.status !== EscrowStatus.LOCKED)
      throw new ForbiddenException('Escrow not releasable');

    escrow.status = EscrowStatus.RELEASED;
    await this.escrowRepo.save(escrow);

    // Credit seller wallet (withdrawable now)
    await this.walletService.unlockFunds(escrow.sellerId, escrow.amount);

    // Ledger release
    await this.ledgerService.record({
      userId: escrow.sellerId,
      amount: escrow.amount,
      type: LedgerType.ESCROW_RELEASE,
      reference: escrow.tradeId,
      source: LedgerSource.ESCROW,
      description: 'Escrow released to seller',
    });

    return escrow;
  }

  async disputeEscrow(escrowId: string) {
    const escrow = await this.escrowRepo.findOneBy({ id: escrowId });
    if (!escrow) {
      throw new NotFoundException(`Escrow with ID ${escrowId} not found`);
    }
    escrow.status = EscrowStatus.DISPUTED;
    return this.escrowRepo.save(escrow);
  }
}
