import { Injectable, NotFoundException } from '@nestjs/common';
import { PayoutStatus } from './enum/payout-status.enum';
import { Payout } from './entities/payout.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ownership } from 'src/tokenization/entities/ownershipt.entity';
import { Revenue } from './entities/revenue.entity';

@Injectable()
export class RevenueService {
  constructor(
    @InjectRepository(Revenue)
    private revenueRepo: Repository<Revenue>,

    @InjectRepository(Payout)
    private payoutRepo: Repository<Payout>,

    @InjectRepository(Ownership)
    private ownershipRepo: Repository<Ownership>,
  ) {}

  /**
   * Record incoming revenue for an asset
   */
  async recordRevenue(assetId: string, amount: number): Promise<Revenue> {
    const revenue = this.revenueRepo.create({
      asset: { id: assetId },
      amount,
    });
    return this.revenueRepo.save(revenue);
  }

  /**
   * Distribute revenue to investors/partners
   */
  async distributeRevenue(revenueId: string): Promise<Payout[]> {
    const revenue = await this.revenueRepo.findOne({
      where: { id: revenueId },
      relations: ['asset'],
    });

    if (!revenue) throw new NotFoundException('Revenue not found');

    const ownerships = await this.ownershipRepo.find({
      where: { asset: { id: revenue.asset.id } },
    });

    const payouts: Payout[] = [];

    const totalShares = ownerships.reduce((sum, o) => sum + o.sharesOwned, 0);

    for (const owner of ownerships) {
      const shareRatio = owner.sharesOwned / totalShares;
      const payoutAmount = Number((revenue.amount * shareRatio).toFixed(2));

      const payout = this.payoutRepo.create({
        revenue,
        ownership: owner,
        amount: payoutAmount,
      });

      payouts.push(await this.payoutRepo.save(payout));
    }

    return payouts;
  }

  /**
   * Mark payout as completed
   */
  async markPayoutCompleted(payoutId: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout not found');

    payout.status = PayoutStatus.COMPLETED;
    payout.paidAt = new Date();

    return this.payoutRepo.save(payout);
  }
}
