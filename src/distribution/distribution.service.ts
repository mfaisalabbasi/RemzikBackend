import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, MoreThan } from 'typeorm';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { Asset } from '../asset/asset.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { PayoutStatus } from './enums/payout-status.enum';
import { Investment } from 'src/investment/investment.entity';
import { LedgerService } from 'src/ledger/ledger.service';

@Injectable()
export class DistributionService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly dataSource: DataSource,
    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,
  ) {}

  async triggerYieldDistribution(
    partnerUserId: string,
    assetId: string,
    totalAmount: number,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Fetch current owners of the asset, NOT initial investors
      // This ensures that people who sold their tokens don't get paid.
      const currentHolders = await manager.find(Ownership, {
        where: {
          assetId: assetId,
          units: MoreThan(0), // Only those currently holding units
          asset: { partner: { user: { id: partnerUserId } } },
        },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (currentHolders.length === 0) {
        throw new BadRequestException(
          'No current asset holders found for distribution.',
        );
      }

      // 2. Calculate Total Units in circulation for this asset
      // We calculate yield per unit based on the total supply currently held.
      const totalUnitsCirculating = currentHolders.reduce(
        (sum, holder) => sum + Number(holder.units),
        0,
      );

      if (totalUnitsCirculating <= 0) {
        throw new BadRequestException(
          'Total circulating units must be greater than zero.',
        );
      }

      const batchId = `BATCH-${Date.now()}`;

      // 3. Map distribution based on beneficial ownership
      const distributionPromises = currentHolders.map(async (holder) => {
        // Yield = (Total Yield / Total Units) * Units Owned by this Holder
        const userYield =
          totalAmount * (Number(holder.units) / totalUnitsCirculating);

        const entry = manager.create(Distribution, {
          asset: holder.asset,
          investor: holder.investor,
          amount: userYield,
          period: new Date().toISOString(),
          status: PayoutStatus.PENDING,
          batchId: batchId,
        });
        return manager.save(entry);
      });

      await Promise.all(distributionPromises);
      return {
        success: true,
        batchId,
        status: 'PENDING_APPROVAL',
        recipients: currentHolders.length,
      };
    });
  }

  async approveDistributionBatch(batchId: string) {
    return await this.dataSource.transaction(async (manager) => {
      const pendingPayouts = await manager.find(Distribution, {
        where: { batchId, status: PayoutStatus.PENDING },
        relations: ['investor', 'investor.user', 'asset'],
      });

      if (pendingPayouts.length === 0)
        throw new NotFoundException('No pending payouts found for this batch.');

      const payoutPromises = pendingPayouts.map(async (payout) => {
        await this.walletService.creditEarned(
          payout.investor.user.id,
          payout.amount,
          LedgerSource.DISTRIBUTION,
          `Yield Approved: ${payout.asset.title}`,
          manager,
        );

        payout.status = PayoutStatus.PAID;
        return manager.save(payout);
      });

      await Promise.all(payoutPromises);
      return { success: true, message: 'Batch processed successfully' };
    });
  }

  async getGlobalPendingBatches() {
    return this.dataSource.query(`
    SELECT 
      "batchId", 
      "assetId", 
      "period",
      COUNT(id) as "investorCount", 
      SUM(amount) as "totalAmount",
      MIN("createdAt") as "requestedAt"
    FROM distributions
    WHERE status = 'PENDING'
    GROUP BY "batchId", "assetId", "period"
    ORDER BY "requestedAt" ASC
  `);
  }

  async rejectDistributionBatch(batchId: string, reason: string) {
    return await this.distributionRepo.delete({
      batchId,
      status: PayoutStatus.PENDING,
    });
  }
}
