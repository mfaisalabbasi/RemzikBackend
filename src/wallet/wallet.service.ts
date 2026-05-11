import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerSource } from '../ledger/enums/ledger-source.enum';
import { LedgerType } from '../ledger/enums/ledger-type.enum';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { Repository, EntityManager } from 'typeorm';
import { Wallet } from './wallet.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class WalletService {
  constructor(
    private readonly ledgerService: LedgerService,
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Wallet) : this.walletRepo;
  }

  async getWallet(userId: string): Promise<WalletResponseDto> {
    const wallet = await this.getOrCreateWallet(userId);

    return {
      availableBalance: Number(wallet.availableBalance),
      lockedBalance: Number(wallet.lockedBalance),
      pendingPayout: Number(wallet.pendingBalance || 0),
      totalEarned: Number(wallet.totalEarned),
      balance: Number(wallet.availableBalance) + Number(wallet.lockedBalance),
    };
  }

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.getOrCreateWallet(userId);
    return Number(wallet.availableBalance);
  }

  async topUpDummy(userId: string, amount: number, manager?: EntityManager) {
    const work = async (em: EntityManager) => {
      await this.creditAvailable(userId, amount, em);
      return this.ledgerService.createEntry(
        userId,
        amount,
        LedgerType.CREDIT,
        LedgerSource.WALLET_DEPOSIT,
        'Demo Funds Top-up',
        em,
      );
    };

    return manager
      ? work(manager)
      : await this.walletRepo.manager.transaction(work);
  }

  private async getOrCreateWallet(
    userId: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    const repo = this.getRepo(manager);
    let wallet = await repo.findOne({ where: { userId } });
    if (!wallet) {
      wallet = repo.create({
        userId,
        availableBalance: 0,
        lockedBalance: 0,
        pendingBalance: 0,
        totalEarned: 0,
      });
      await repo.save(wallet);
    }
    return wallet;
  }

  async creditAvailable(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({
        availableBalance: () => `availableBalance + ${amount}`,
      })
      .where('userId = :userId', { userId })
      .execute();
  }

  async debitAvailable(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    const wallet = await this.getOrCreateWallet(userId, manager);

    if (Number(wallet.availableBalance) < amount) {
      throw new BadRequestException(
        'Insufficient available balance for this transaction',
      );
    }

    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ availableBalance: () => `availableBalance - ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
  }

  async creditEarned(
    userId: string,
    amount: number,
    source: LedgerSource,
    note?: string,
    manager?: EntityManager,
  ) {
    const repo = this.getRepo(manager);
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({
        availableBalance: () => `availableBalance + ${amount}`,
        totalEarned: () => `totalEarned + ${amount}`,
      })
      .where('userId = :userId', { userId })
      .execute();

    return this.ledgerService.createEntry(
      userId,
      amount,
      LedgerType.CREDIT,
      source,
      note,
      manager,
    );
  }

  async lockFunds(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    await this.debitAvailable(userId, amount, manager);

    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ lockedBalance: () => `lockedBalance + ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
  }

  async unlockFunds(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({
        lockedBalance: () => `lockedBalance - ${amount}`,
        availableBalance: () => `availableBalance + ${amount}`,
      })
      .where('userId = :userId', { userId })
      .execute();
  }

  async debitLocked(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    const wallet = await this.getOrCreateWallet(userId, manager);
    const currentLocked = Number(wallet.pendingBalance || 0);

    if (currentLocked < amount) {
      throw new BadRequestException(
        'Insufficient pending/locked funds for this payout',
      );
    }

    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ pendingBalance: () => `pendingBalance - ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
  }

  async requestPayout(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    await this.debitAvailable(userId, amount, manager);

    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ pendingBalance: () => `pendingBalance + ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
  }

  async finalizePayout(
    userId: string,
    amount: number,
    success: boolean,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    if (success) {
      await repo
        .createQueryBuilder()
        .update(Wallet)
        .set({ pendingBalance: () => `pendingBalance - ${amount}` })
        .where('userId = :userId', { userId })
        .execute();
    } else {
      await repo
        .createQueryBuilder()
        .update(Wallet)
        .set({
          pendingBalance: () => `pendingBalance - ${amount}`,
          availableBalance: () => `availableBalance + ${amount}`,
        })
        .where('userId = :userId', { userId })
        .execute();
    }
  }

  async getAvailableBalance(userId: string): Promise<number> {
    const wallet = await this.getOrCreateWallet(userId);
    return Number(wallet.availableBalance);
  }

  async credit(
    userId: string,
    amount: number,
    source: LedgerSource,
    note?: string,
    manager?: EntityManager,
  ) {
    await this.creditAvailable(userId, amount, manager);
    return this.ledgerService.createEntry(
      userId,
      amount,
      LedgerType.CREDIT,
      source,
      note,
      manager,
    );
  }

  /**
   * ✅ NEW: SYSTEM-WIDE ATOMIC TRANSFER
   * Moves money from one user to another and creates two ledger entries.
   */
  async transfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    source: LedgerSource,
    note: string,
    manager: EntityManager,
  ): Promise<void> {
    // 1. Debit Source
    await this.debitAvailable(fromUserId, amount, manager);
    await this.ledgerService.createEntry(
      fromUserId,
      amount,
      LedgerType.DEBIT,
      source,
      note,
      manager,
    );

    // 2. Credit Destination
    await this.creditAvailable(toUserId, amount, manager);
    await this.ledgerService.createEntry(
      toUserId,
      amount,
      LedgerType.CREDIT,
      source,
      note,
      manager,
    );
  }

  async transferLockedToAvailable(
    buyerId: string,
    sellerId: string,
    amount: number,
    manager: EntityManager,
  ): Promise<void> {
    await manager.decrement(
      Wallet,
      { userId: buyerId },
      'lockedBalance',
      amount,
    );

    await manager.increment(
      Wallet,
      { userId: sellerId },
      'availableBalance',
      amount,
    );

    const buyerWallet = await manager.findOne(Wallet, {
      where: { userId: buyerId },
    });
    if (buyerWallet && Number(buyerWallet.lockedBalance) < 0) {
      throw new BadRequestException('Insufficient escrowed funds for transfer');
    }
  }
}
