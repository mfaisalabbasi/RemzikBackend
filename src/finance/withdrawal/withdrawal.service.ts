import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Withdrawal, WithdrawalStatus } from './withdrawal.entity';
import { WalletService } from '../../wallet/wallet.service';
import { AuditService } from '../../audit/audit.service';
import { AdminAction } from '../../audit/enums/audit-action.enum';

@Injectable()
export class WithdrawalService {
  constructor(
    @InjectRepository(Withdrawal)
    private readonly withdrawalRepo: Repository<Withdrawal>,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * USER: Request a withdrawal
   * Checks available balance and moves funds to PendingBalance immediately.
   */
  async request(
    userId: string,
    amount: number,
    bankInfo: { iban: string; bankName: string },
  ) {
    const available = await this.walletService.getAvailableBalance(userId);

    if (available < amount) {
      throw new BadRequestException('Insufficient balance in wallet');
    }

    // 1. Create Withdrawal Record
    const withdrawal = this.withdrawalRepo.create({
      userId,
      amount,
      ...bankInfo,
      status: WithdrawalStatus.PENDING,
    });
    const saved = await this.withdrawalRepo.save(withdrawal);

    // 2. Lock Funds in Wallet (Moves funds from Available -> PendingBalance)
    await this.walletService.requestPayout(userId, amount);

    // 3. Audit Log
    await this.auditService.log({
      adminId: userId,
      targetId: saved.id,
      action: AdminAction.WITHDRAW_REQ,
      reason: `User initiated a withdrawal of ${amount} SAR`,
    });

    return saved;
  }

  /**
   * ADMIN: Approve and finalize withdrawal
   * Permanently clears the Pending balance once the transfer is confirmed.
   */
  async approve(id: string, adminId: string) {
    const withdrawal = await this.withdrawalRepo.findOne({ where: { id } });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        'Withdrawal is already processed or rejected',
      );
    }

    // 1. Finalize Wallet Debit (Permanently removes money from pendingBalance)
    await this.walletService.finalizePayout(
      withdrawal.userId,
      withdrawal.amount,
      true,
    );

    // 2. Update Status to Completed
    withdrawal.status = WithdrawalStatus.COMPLETED;
    const updated = await this.withdrawalRepo.save(withdrawal);

    // 3. Audit Log (Actor is Admin)
    await this.auditService.log({
      adminId: adminId,
      targetId: updated.id,
      action: AdminAction.WITHDRAW_APPROVED,
      reason: 'Admin approved and confirmed bank transfer',
    });

    return updated;
  }

  /**
   * ADMIN: Reject withdrawal
   * Returns money from PendingBalance back to AvailableBalance.
   */
  async reject(id: string, adminId: string, reason: string) {
    const withdrawal = await this.withdrawalRepo.findOne({ where: { id } });

    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Invalid withdrawal request');
    }

    // 1. Return funds back to Available
    await this.walletService.finalizePayout(
      withdrawal.userId,
      withdrawal.amount,
      false,
    );

    // 2. Update status
    withdrawal.status = WithdrawalStatus.REJECTED;
    const updated = await this.withdrawalRepo.save(withdrawal);

    // 3. Audit Log
    await this.auditService.log({
      adminId: adminId,
      targetId: updated.id,
      action: AdminAction.WITHDRAW_REJECTED,
      reason: `Admin rejected withdrawal: ${reason}`,
    });

    return updated;
  }
}
