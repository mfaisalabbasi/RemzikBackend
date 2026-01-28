import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Withdrawal } from './withdrawal.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { WithdrawalStatus } from './enums/withdrawal-status.enum';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';

@Injectable()
export class WithdrawalService {
  constructor(
    @InjectRepository(Withdrawal)
    private readonly withdrawalRepo: Repository<Withdrawal>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
  ) {}

  // Request a withdrawal
  async requestWithdrawal({ userId, amount, method, destination }) {
    const wallet = await this.walletService.getWallet(userId);

    if (!wallet || wallet.availableBalance < amount) {
      throw new ForbiddenException('Insufficient balance');
    }

    // 1️⃣ Create withdrawal first
    const withdrawal = this.withdrawalRepo.create({
      userId,
      amount,
      method,
      destination,
      status: WithdrawalStatus.PENDING, // Use PENDING or REQUESTED
    });

    await this.withdrawalRepo.save(withdrawal); // Save to get ID

    // 2️⃣ Deduct from wallet
    await this.walletService.debitAvailable(userId, amount);

    // 3️⃣ Create ledger entry
    await this.ledgerService.record({
      userId,
      amount,
      type: LedgerType.WITHDRAWAL_REQUEST,
      source: LedgerSource.WITHDRAWAL,
      reference: withdrawal.id,
      description: 'Withdrawal requested',
    });

    return withdrawal;
  }

  // Approve a withdrawal
  async approveWithdrawal(id: string) {
    const withdrawal = await this.withdrawalRepo.findOneBy({ id });
    if (!withdrawal) throw new ForbiddenException('Withdrawal not found');

    withdrawal.status = WithdrawalStatus.APPROVED;
    return this.withdrawalRepo.save(withdrawal);
  }

  // Reject a withdrawal
  async rejectWithdrawal(id: string) {
    const withdrawal = await this.withdrawalRepo.findOneBy({ id });
    if (!withdrawal) throw new ForbiddenException('Withdrawal not found');

    // Refund wallet
    await this.walletService.creditAvailable(
      withdrawal.userId,
      withdrawal.amount,
    );

    withdrawal.status = WithdrawalStatus.REJECTED;
    return this.withdrawalRepo.save(withdrawal);
  }

  // Mark a withdrawal as paid
  async markAsPaid(id: string) {
    const withdrawal = await this.withdrawalRepo.findOneBy({ id });
    if (!withdrawal) throw new ForbiddenException('Withdrawal not found');

    withdrawal.status = WithdrawalStatus.PAID;

    await this.ledgerService.record({
      userId: withdrawal.userId,
      amount: withdrawal.amount,
      type: LedgerType.WITHDRAWAL_PAID,
      source: LedgerSource.WITHDRAWAL,
      reference: withdrawal.id,
      description: 'Withdrawal completed',
    });

    return this.withdrawalRepo.save(withdrawal);
  }
}
