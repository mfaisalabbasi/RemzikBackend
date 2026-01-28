import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payout } from './payout.entity';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';
import { PayoutStatus } from './enums/payout-status.enum';
import { WalletService } from '../wallet/wallet.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerType } from '../ledger/enums/ledger-type.enum';
import { LedgerSource } from '../ledger/enums/ledger-source.enum';
import { User } from '../user/user.entity';

@Injectable()
export class PayoutService {
  constructor(
    @InjectRepository(Payout)
    private readonly payoutRepo: Repository<Payout>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Request a payout
   */
  async requestPayout(user: User, dto: CreatePayoutDto): Promise<Payout> {
    const availableBalance = await this.walletService.getBalance(user.id);

    if (dto.amount > availableBalance) {
      throw new BadRequestException('Insufficient balance for payout');
    }

    const payout = this.payoutRepo.create({
      investor: user,
      amount: dto.amount,
      status: PayoutStatus.REQUESTED,
    });

    return this.payoutRepo.save(payout);
  }

  /**
   * Update payout status (COMPLETED / FAILED)
   */
  async updatePayoutStatus(
    id: string,
    dto: UpdatePayoutStatusDto,
  ): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id },
      relations: ['investor'],
    });

    if (!payout) throw new NotFoundException('Payout not found');

    payout.status = dto.status;

    // If COMPLETED, debit wallet and create ledger entry
    if (dto.status === PayoutStatus.COMPLETED) {
      await this.walletService.debit(
        payout.investor.id,
        payout.amount,
        'Payout completed',
      );
    }

    // If FAILED, optionally credit wallet back
    if (dto.status === PayoutStatus.FAILED) {
      await this.walletService.credit(
        payout.investor.id,
        payout.amount,
        LedgerSource.PAYOUT_FAILED,
        'Payout failed',
      );
    }

    return this.payoutRepo.save(payout);
  }

  /**
   * Get all payouts for a user
   */
  async getUserPayouts(userId: string): Promise<Payout[]> {
    return this.payoutRepo.find({ where: { investor: { id: userId } } });
  }

  /**
   * Get all payouts (admin)
   */
  async getAllPayouts(): Promise<Payout[]> {
    return this.payoutRepo.find({ relations: ['investor'] });
  }

  // Analytics `section------------
  // Get all payouts by a user
  async getByUser(userId: string): Promise<Payout[]> {
    return this.payoutRepo.find({
      where: { investor: { id: userId } },
      relations: ['investor'],
    });
  }

  // Get total payouts for a specific asset
  async getTotalByAsset(assetId: string): Promise<number> {
    const result = await this.payoutRepo
      .createQueryBuilder('payout')
      .leftJoin('payout.asset', 'asset')
      .select('SUM(payout.amount)', 'total')
      .where('asset.id = :assetId', { assetId })
      .getRawOne();

    return Number(result.total) || 0;
  }

  // Get total payouts across all users
  async getTotalPayouts(): Promise<number> {
    const result = await this.payoutRepo
      .createQueryBuilder('payout')
      .select('SUM(payout.amount)', 'total')
      .getRawOne();

    return Number(result.total) || 0;
  }

  //cron
  // Get a payout by ID
  async getById(id: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id },
      relations: ['investor'],
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  // Get all pending payouts (requested but not completed)
  async getPendingPayouts(): Promise<Payout[]> {
    return this.payoutRepo.find({
      where: { status: PayoutStatus.REQUESTED },
      relations: ['investor'],
    });
  }

  // Execute payout (simulate bank/crypto transfer)
  async executePayout(payout: Payout): Promise<boolean> {
    try {
      // --- your actual payout integration (bank/crypto) goes here ---
      // For now, just simulate success
      return true;
    } catch (err) {
      return false;
    }
  }

  //secondary market updates

  async settleSeller({
    sellerId,
    amount,
    tradeId,
  }: {
    sellerId: string;
    amount: number;
    tradeId: string;
  }) {
    // 1️⃣ Create payout record
    const payout = this.payoutRepo.create({
      userId: sellerId,
      referenceId: tradeId,
      amount,
      status: PayoutStatus.PENDING,
    });

    await this.payoutRepo.save(payout);

    try {
      // 2️⃣ Credit seller wallet
      await this.walletService.credit(
        sellerId,
        amount,
        LedgerSource.SECONDARY_MARKET_SELL,
      );

      // 3️⃣ Ledger entry
      await this.ledgerService.record({
        userId: sellerId,
        amount,
        type: LedgerType.CREDIT,
        source: LedgerSource.SECONDARY_MARKET_SELL,
        reference: tradeId,
        description: 'Secondary market sale settlement',
      });

      // 4️⃣ Mark payout completed
      payout.status = PayoutStatus.COMPLETED;
      return this.payoutRepo.save(payout);
    } catch (error) {
      payout.status = PayoutStatus.FAILED;
      await this.payoutRepo.save(payout);
      throw error;
    }
  }
}
