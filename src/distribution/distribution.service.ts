import { BadRequestException, Injectable } from '@nestjs/common';
import { RevenueStatus } from './enums/distribution-status.enum';
import { PayoutStatus } from './enums/payout-status.enum';
import { TokenizationService } from 'src/tokenization/tokenization.service';
import { Repository } from 'typeorm';
import { Payout } from './entities/payout.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Revenue } from './entities/distribution.entity';

@Injectable()
export class RevenueService {
  constructor(
    @InjectRepository(Revenue)
    private revenueRepo: Repository<Revenue>,

    @InjectRepository(Payout)
    private payoutRepo: Repository<Payout>,

    private tokenizationService: TokenizationService,
  ) {}

  // Create Revenue Entry

  async recordRevenue(assetId: string, totalAmount: number) {
    const platformFee = totalAmount * 0.05; // 5%
    const distributable = totalAmount - platformFee;

    return this.revenueRepo.save({
      asset: { id: assetId },
      totalAmount,
      platformFee,
      distributableAmount: distributable,
      status: RevenueStatus.PENDING,
    });
  }

  // DISTRIBUTE REVENUE (CRITICAL FUNCTION)

  // async distributeRevenue(revenueId: string) {
  //   const revenue = await this.revenueRepo.findOne({
  //     where: { id: revenueId },
  //   });

  //   if (!revenue || revenue.status === RevenueStatus.DISTRIBUTED) {
  //     throw new BadRequestException('Invalid revenue state');
  //   }

  //   const ownerships =
  //     await this.tokenizationService.getOwnershipSnapshot(
  //       revenue.asset.id,
  //     );

  //   for (const o of ownerships) {
  //     const payoutAmount =
  //       (revenue.distributableAmount * o.percentage) / 100;

  //     await this.payoutRepo.save({
  //       revenue,
  //       user: { id: o.userId },
  //       ownershipPercentage: o.percentage,
  //       amount: payoutAmount,
  //       status: PayoutStatus.PENDING,
  //     });
  //   }

  //   revenue.status = RevenueStatus.DISTRIBUTED;
  //   await this.revenueRepo.save(revenue);
  // }
}
