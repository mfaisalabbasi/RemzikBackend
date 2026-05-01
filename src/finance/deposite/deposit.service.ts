import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Deposit, DepositStatus } from './deposit.entity';
import { WalletService } from '../../wallet/wallet.service';
import { LedgerSource } from '../../ledger/enums/ledger-source.enum';

@Injectable()
export class DepositService {
  constructor(
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Core logic for processing deposits.
   * This is used by both the Simulation and future Real Payment Webhooks.
   */
  async processDeposit(
    userId: string,
    amount: number,
    provider: string,
    referenceId: string,
    externalManager?: EntityManager,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    const work = async (manager: EntityManager) => {
      // 1. IDEMPOTENCY CHECK: Ensure we haven't processed this external reference before
      const existing = await manager.findOne(Deposit, {
        where: { referenceId },
      });
      if (existing) return existing;

      // 2. Create the Deposit record
      const deposit = manager.create(Deposit, {
        userId,
        amount,
        provider,
        status: DepositStatus.COMPLETED,
        referenceId,
      });
      const saved = await manager.save(deposit);

      // 3. Update Wallet & Ledger
      await this.walletService.credit(
        userId,
        amount,
        LedgerSource.DEPOSIT,
        `Deposit via ${provider} (Ref: ${referenceId})`,
        manager,
      );

      return saved;
    };

    return externalManager
      ? work(externalManager)
      : await this.depositRepo.manager.transaction(work);
  }

  /**
   * SIMULATION: For testing the flow without a real payment gateway.
   */
  async processSimulation(userId: string, amount: number) {
    return this.processDeposit(
      userId,
      amount,
      'DEMO_SIMULATION',
      `SIM-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    );
  }

  /**
   * 🚀 PLUG-IN READY: Real-world Webhook handler
   * Call this when Moyasar/Mada sends a "payment.captured" event.
   */
  async handleWebhook(payload: any) {
    // 1. Verify Signature (Future Step)
    // 2. Extract Data: const { userId, amount, referenceId, provider } = payload;
    // 3. return this.processDeposit(userId, amount, provider, referenceId);
  }
}
