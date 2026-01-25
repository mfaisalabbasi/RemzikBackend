import { Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerSource } from '../ledger/enums/ledger-source.enum';
import { LedgerType } from '../ledger/enums/ledger-type.enum';
import { WalletResponseDto } from './dto/wallet-response.dto';

@Injectable()
export class WalletService {
  constructor(private readonly ledgerService: LedgerService) {}

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
      }
    }

    return {
      availableBalance: available,
      lockedBalance: locked,
      pendingPayout: pending,
      totalEarned: earned,
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
      LedgerType.PAYOUT, // broad category
      LedgerSource.PAYOUT_COMPLETED, // specific reason
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
      Math.abs(amount), // amount entering
      LedgerType.PAYOUT, // category
      source, // reason/event
      note,
    );
  }
}
