import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async processSimulation(userId: string, amount: number) {
    const deposit = this.depositRepo.create({
      userId,
      amount,
      provider: 'DEMO_SIMULATION',
      status: DepositStatus.COMPLETED,
      referenceId: 'SIM-' + Date.now(),
    });

    const saved = await this.depositRepo.save(deposit);

    await this.walletService.credit(
      userId,
      amount,
      LedgerSource.DEPOSIT,
      `Simulated deposit of ${amount} SAR`,
    );

    return saved;
  }
}
