import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from './dispute.entity';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { DisputeStatus } from './dispute.enums';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
@Injectable()
export class DisputeService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
  ) {}

  // USER creates dispute
  async createDispute(userId: string, dto: CreateDisputeDto) {
    const dispute = this.disputeRepo.create({
      userId,
      type: dto.type,
      referenceId: dto.referenceId,
      reason: dto.reason,
      status: DisputeStatus.OPEN,
    });

    return this.disputeRepo.save(dispute);
  }

  // USER views own disputes
  async getUserDisputes(userId: string) {
    return this.disputeRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ADMIN views all disputes
  async getAllDisputes() {
    return this.disputeRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  // SHARED: get by id
  async getById(id: string) {
    const dispute = await this.disputeRepo.findOne({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }

  async resolveDispute(
    disputeId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ) {
    const dispute = await this.getById(disputeId);

    if (dispute.status !== DisputeStatus.OPEN) {
      throw new Error('Dispute already handled');
    }

    dispute.status = dto.status;
    dispute.adminNote = dto.adminNote;
    dispute.resolvedAt = new Date();

    await this.disputeRepo.save(dispute);

    return dispute;
  }

  async applyResolution(disputeId: string) {
    const dispute = await this.getById(disputeId);

    if (dispute.status !== DisputeStatus.RESOLVED) return;

    if (dispute.type === 'PAYOUT') {
      // Example: compensate payout
      const compensationAmount = 100; // calculated safely elsewhere

      await this.walletService.adjustBalance(
        dispute.userId,
        compensationAmount,
      );

      await this.ledgerService.recordDisputeAdjustment(
        dispute.userId,
        compensationAmount,
        dispute.id,
      );
    }
  }
}
