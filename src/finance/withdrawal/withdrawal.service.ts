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
// 🛡️ IMPORT FROM THE CORRECT AUDIT ENUM LOCATION
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
   * Checks available balance and locks funds immediately.
   */
  async request(
    userId: string,
    amount: number,
    bankInfo: { iban: string; bankName: string },
  ) {
    // 1. Check current available balance
    const available = await this.walletService.getAvailableBalance(userId);

    if (available < amount) {
      throw new BadRequestException('Insufficient balance in wallet');
    }

    // 2. Create Withdrawal Record
    const withdrawal = this.withdrawalRepo.create({
      userId,
      amount,
      ...bankInfo,
      status: WithdrawalStatus.PENDING,
    });
    const saved = await this.withdrawalRepo.save(withdrawal);

    // 3. Lock Funds in Wallet
    // Moves funds from available -> locked to prevent double spending
    await this.walletService.lockFunds(userId, amount);

    // 4. Audit Log (Actor is the User requesting)
    await this.auditService.log({
      adminId: userId, // The person initiating the action
      targetId: saved.id,
      action: AdminAction.WITHDRAW_REQ,
      reason: `User initiated a withdrawal of ${amount} SAR`,
    });

    return saved;
  }

  /**
   * ADMIN: Approve and finalize withdrawal
   * Clears the locked balance permanently after bank transfer is done.
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

    // 1. Update Status to Completed
    withdrawal.status = WithdrawalStatus.COMPLETED;
    const updated = await this.withdrawalRepo.save(withdrawal);

    // 2. Finalize Wallet Debit
    // This permanently removes the money from the user's locked balance
    await this.walletService.debitLocked(withdrawal.userId, withdrawal.amount);

    // 3. Audit Log (Actor is Faisal/Admin)
    await this.auditService.log({
      adminId: adminId,
      targetId: updated.id,
      action: AdminAction.WITHDRAW_APPROVED,
      reason: 'Admin approved and confirmed bank transfer',
    });

    return updated;
  }
}
