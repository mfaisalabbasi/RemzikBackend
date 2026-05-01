import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
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
   * STEP 1: User requests funds.
   * Logic: Moves money from 'Available' to 'Pending' immediately to reserve it.
   */
  async request(
    userId: string,
    amount: number,
    bankInfo: { iban: string; bankName: string },
  ) {
    if (amount < 10)
      throw new BadRequestException('Minimum withdrawal is 10 SAR');

    return await this.withdrawalRepo.manager.transaction(async (manager) => {
      // 1. Verify Balance: Use transactional check to prevent race conditions
      const available = await this.walletService.getAvailableBalance(userId);
      if (available < amount)
        throw new BadRequestException('Insufficient balance');

      // 2. Create the immutable withdrawal record
      const withdrawal = manager.create(Withdrawal, {
        userId,
        amount,
        ...bankInfo,
        status: WithdrawalStatus.PENDING,
      });
      const saved = await manager.save(withdrawal);

      // 3. Reserve funds: (Available -> PendingBalance)
      // This money is now "In Transit" and cannot be spent on trades/investments
      await this.walletService.requestPayout(userId, amount, manager);

      // 4. Audit Trail
      await this.auditService.log(
        {
          adminId: userId, // In request phase, the 'admin' is the user themselves
          targetId: saved.id,
          action: AdminAction.WITHDRAW_REQ,
          reason: `User initiated withdrawal of ${amount} SAR to ${bankInfo.bankName}`,
        },
        manager,
      );

      return saved;
    });
  }

  /**
   * STEP 2: Admin Approves & Executes Payout.
   * This is the "Plug and Play" bridge to the Banking Rails (SARIE/Lean/Moyasar).
   */
  async approve(id: string, adminId: string) {
    return await this.withdrawalRepo.manager.transaction(async (manager) => {
      // 1. Pessimistic Write Lock:
      // Prevents two admins from approving the same withdrawal at the exact same millisecond.
      const withdrawal = await manager
        .getRepository(Withdrawal)
        .createQueryBuilder('w')
        .setLock('pessimistic_write')
        .where('w.id = :id', { id })
        .getOne();

      if (!withdrawal)
        throw new NotFoundException('Withdrawal request not found');

      // 2. Idempotency Check:
      // Ensure we don't process a request that is already completed or rejected.
      if (withdrawal.status !== WithdrawalStatus.PENDING) {
        throw new BadRequestException(
          `Withdrawal is already ${withdrawal.status.toLowerCase()}`,
        );
      }

      /**
       * 🏦 PLUG-IN READY: EXTERNAL BANK TRANSFER (The Payout Execution)
       * -----------------------------------------------------------------
       * This is where you connect to the Real World.
       *
       * Example Integration:
       * const payoutResponse = await this.payoutGateway.transfer({
       *    destinationIban: withdrawal.iban,
       *    amount: withdrawal.amount,
       *    reference: withdrawal.id // Use our DB ID as the bank reference
       * });
       *
       * if (payoutResponse.failed) {
       *    throw new Error("Bank Gateway rejected the transfer");
       * }
       * -----------------------------------------------------------------
       */

      // 3. Finalize Wallet: (Permanently removes money from PendingBalance)
      await this.walletService.finalizePayout(
        withdrawal.userId,
        withdrawal.amount,
        true, // isSuccess = true
        manager,
      );

      // 4. Update Final Status
      withdrawal.status = WithdrawalStatus.COMPLETED;
      const updated = await manager.save(withdrawal);

      // 5. Log for Compliance/Audit
      await this.auditService.log(
        {
          adminId,
          targetId: updated.id,
          action: AdminAction.WITHDRAW_APPROVED,
          reason: 'Bank transfer executed and ledger finalized',
        },
        manager,
      );

      return updated;
    });
  }

  /**
   * STEP 3 (Alternative): Admin Rejects.
   * Logic: Unlocks 'Pending' funds and returns them to 'Available'.
   */
  async reject(id: string, adminId: string, reason: string) {
    return await this.withdrawalRepo.manager.transaction(async (manager) => {
      // Lock record to prevent concurrent modifications
      const withdrawal = await manager
        .getRepository(Withdrawal)
        .createQueryBuilder('w')
        .setLock('pessimistic_write')
        .where('w.id = :id', { id })
        .getOne();

      if (!withdrawal || withdrawal.status !== WithdrawalStatus.PENDING) {
        throw new BadRequestException(
          'Invalid or already processed withdrawal request',
        );
      }

      // 1. Release Reserved Funds: (PendingBalance -> AvailableBalance)
      await this.walletService.finalizePayout(
        withdrawal.userId,
        withdrawal.amount,
        false, // isSuccess = false (Money returns to user)
        manager,
      );

      // 2. Update Status
      withdrawal.status = WithdrawalStatus.REJECTED;
      withdrawal.adminNote = reason;
      const updated = await manager.save(withdrawal);

      // 3. Audit Trail
      await this.auditService.log(
        {
          adminId,
          targetId: updated.id,
          action: AdminAction.WITHDRAW_REJECTED,
          reason: `Admin rejected withdrawal. Reason: ${reason}`,
        },
        manager,
      );

      return updated;
    });
  }

  // Add these to your existing WithdrawalService class

  /**
   * For Analytics: Get all withdrawals for a specific user
   */
  async getByUser(userId: string): Promise<Withdrawal[]> {
    return this.withdrawalRepo.find({ where: { userId } });
  }

  /**
   * For Cron: Get all pending requests to attempt processing
   */
  async getPendingRequests(): Promise<Withdrawal[]> {
    return this.withdrawalRepo.find({
      where: { status: WithdrawalStatus.PENDING },
    });
  }

  /**
   * For Payout Retry: Find a specific withdrawal by ID
   */
  async getById(id: string): Promise<Withdrawal> {
    const record = await this.withdrawalRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Withdrawal not found');
    return record;
  }

  /**
   * 🚀 FUTURE PROOF: Placeholder for the actual bank execution
   * This replaces 'executePayout' from your old service
   */
  async executePayout(withdrawal: Withdrawal): Promise<boolean> {
    // Logic to call your real bank API would go here
    console.log(`Executing payout for ${withdrawal.id}`);
    return true;
  }

  /**
   * For Analytics: Sum up withdrawals for a specific asset (if applicable)
   */
  async getTotalByAsset(assetId: string): Promise<number> {
    const result = await this.withdrawalRepo
      .createQueryBuilder('withdrawal')
      .select('SUM(withdrawal.amount)', 'total')
      .where('withdrawal.assetId = :assetId', { assetId })
      .andWhere('withdrawal.status = :status', {
        status: WithdrawalStatus.COMPLETED,
      })
      .getRawOne();
    return result.total || 0;
  }

  /**
   * For Cron: Finalize the status of a withdrawal
   */
  async finalizePayout(
    id: string,
    data: { status: WithdrawalStatus; reason?: string }, // Added reason here
  ): Promise<void> {
    await this.withdrawalRepo.update(id, {
      status: data.status,
      adminNote: data.reason, // Map 'reason' to your 'adminNote' column
    });
  }

  /**
   * For Payout Retry: A simple status update helper
   */
  async updatePayoutStatus(
    id: string,
    status: WithdrawalStatus,
  ): Promise<void> {
    await this.withdrawalRepo.update(id, { status });
  }
}
