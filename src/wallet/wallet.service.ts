import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerSource } from '../ledger/enums/ledger-source.enum';
import { LedgerType } from '../ledger/enums/ledger-type.enum';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class WalletService {
  constructor(
    private readonly ledgerService: LedgerService,
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
  ) {}

  /**
   * Get full wallet balances for a user
   */
  async getWallet(userId: string): Promise<WalletResponseDto> {
    const entries = await this.ledgerService.findByUser(userId);

    let available = 0;
    let pending = 0;
    let locked = 0;
    let earned = 0;

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
      }
    }

    return {
      availableBalance: available,
      lockedBalance: locked,
      pendingPayout: pending,
      totalEarned: earned,
      balance: available + locked, // ✅ total balance
    };
  }

  /**
   * Shortcut to get only available balance
   */
  async getBalance(userId: string): Promise<number> {
    const wallet = await this.getWallet(userId);
    return wallet.availableBalance;
  }

  /**
   * Debit wallet (money leaves wallet)
   */
  async debit(userId: string, amount: number, note?: string) {
    return this.ledgerService.createEntry(
      userId,
      -Math.abs(amount), // amount leaving
      LedgerType.PAYOUT,
      LedgerSource.PAYOUT_COMPLETED,
      note,
    );
  }

  /**
   * Credit wallet (money enters wallet)
   */
  async credit(
    userId: string,
    amount: number,
    source: LedgerSource,
    note?: string,
  ) {
    return this.ledgerService.createEntry(
      userId,
      Math.abs(amount),
      LedgerType.PAYOUT,
      source,
      note,
    );
  }

  /**
   * Lock funds for escrow or pending operations
   */
  async lockFunds(userId: string, amount: number): Promise<void> {
    const wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.availableBalance < amount)
      throw new BadRequestException('Insufficient available balance');

    wallet.availableBalance -= amount;
    wallet.lockedBalance += amount;

    await this.walletRepo.save(wallet);
  }

  /**
   * Unlock previously locked funds
   */
  async unlockFunds(userId: string, amount: number): Promise<void> {
    const wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    wallet.lockedBalance -= amount;
    wallet.availableBalance += amount;

    await this.walletRepo.save(wallet);
  }

  /**
   * Adjust balance directly (admin use)
   */
  async adjustBalance(userId: string, amount: number): Promise<void> {
    const wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    // Update both total balance and available balance
    wallet.availableBalance += amount;
    await this.walletRepo.save(wallet);
  }

  /**
   * Debit available balance only
   */
  async debitAvailable(userId: string, amount: number): Promise<void> {
    const wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.availableBalance < amount)
      throw new BadRequestException('Insufficient available balance');

    wallet.availableBalance -= amount;
    await this.walletRepo.save(wallet);
  }

  /**
   * Credit available balance only
   */
  async creditAvailable(userId: string, amount: number): Promise<void> {
    const wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    wallet.availableBalance += amount;
    await this.walletRepo.save(wallet);
  }
}
