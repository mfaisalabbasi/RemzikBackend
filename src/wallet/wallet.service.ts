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
    const entries = await this.ledgerService.findByUser(userId);
    let available = 0,
      pending = 0,
      locked = 0,
      earned = 0;

    for (const entry of entries) {
      const amount = Number(entry.amount);
      switch (entry.source) {
        case LedgerSource.DISTRIBUTION_ENGINE:
          available += amount;
          earned += amount;
          break;
        case LedgerSource.PAYOUT_REQUEST:
          available -= amount;
          pending += amount;
          break;
        case LedgerSource.PAYOUT_COMPLETED:
          pending -= amount;
          break;
        case LedgerSource.PAYOUT_FAILED:
          available += amount;
          pending -= amount;
          break;
        case LedgerSource.INVESTMENT_CONFIRMATION:
        case LedgerSource.ADMIN_ADJUSTMENT:
        case LedgerSource.WALLET_DEPOSIT:
        case LedgerSource.SECONDARY_MARKET_SELL:
          available += amount;
          break;
        case LedgerSource.ESCROW_LOCK:
          locked += amount;
          available -= amount;
          break;
        case LedgerSource.ESCROW_RELEASE:
          locked -= amount;
          available += amount;
          break;
        case LedgerSource.ASSET_INVESTMENT:
        case LedgerSource.SECONDARY_MARKET_BUY:
          available -= Math.abs(amount);
          break;
      }
    }
    return {
      availableBalance: available,
      lockedBalance: locked,
      pendingPayout: pending,
      totalEarned: earned,
      balance: available + locked,
    };
  }

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.getWallet(userId);
    return wallet.availableBalance;
  }

  async topUpDummy(userId: string, amount: number, manager?: EntityManager) {
    await this.creditAvailable(userId, amount, manager);
    return this.ledgerService.createEntry(
      userId,
      amount,
      LedgerType.CREDIT,
      LedgerSource.WALLET_DEPOSIT,
      'Demo Funds Top-up',
      manager,
    );
  }

  private async getOrCreateWallet(
    userId: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    const repo = this.getRepo(manager);
    let wallet = await repo.findOne({ where: { userId } });
    if (!wallet) {
      wallet = repo.create({ userId, availableBalance: 0, lockedBalance: 0 });
      await repo.save(wallet);
    }
    return wallet;
  }

  // ✅ FIXED: Using atomic updates to prevent race conditions
  async creditAvailable(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ availableBalance: () => `availableBalance + ${amount}` })
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
    if (Number(wallet.availableBalance) < amount)
      throw new BadRequestException('Insufficient available balance');
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ availableBalance: () => `availableBalance - ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
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
      Math.abs(amount),
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
    const wallet = await this.getOrCreateWallet(userId, manager);
    if (Number(wallet.availableBalance) < amount)
      throw new BadRequestException('Insufficient available balance');
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({
        availableBalance: () => `availableBalance - ${amount}`,
        lockedBalance: () => `lockedBalance + ${amount}`,
      })
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

  async adjustBalance(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ availableBalance: () => `availableBalance + ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
  }

  async getAvailableBalance(userId: string): Promise<number> {
    const wallet = await this.getOrCreateWallet(userId);
    return Number(wallet.availableBalance);
  }

  async debitLocked(
    userId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    const wallet = await this.getOrCreateWallet(userId, manager);
    if (Number(wallet.lockedBalance) < amount)
      throw new BadRequestException('Insufficient locked funds');
    await repo
      .createQueryBuilder()
      .update(Wallet)
      .set({ lockedBalance: () => `lockedBalance - ${amount}` })
      .where('userId = :userId', { userId })
      .execute();
  }
}
