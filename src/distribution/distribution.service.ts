import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { Asset } from '../asset/asset.entity';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { PayoutStatus } from './enums/payout-status.enum';
import { Investment } from 'src/investment/investment.entity';
import { LedgerService } from 'src/ledger/ledger.service';
import { InvestmentStatus } from 'src/investment/enums/investment-status.enum';
// src/distribution/distribution.service.ts

@Injectable()
export class DistributionService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly dataSource: DataSource, // For atomic transactions
    @InjectRepository(Distribution) // Ensure this is injected
    private readonly distributionRepo: Repository<Distribution>,
  ) {}

  async triggerYieldDistribution(
    partnerUserId: string,
    assetId: string,
    totalAmount: number,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      const investments = await manager.find(Investment, {
        where: {
          asset: { id: assetId, partner: { user: { id: partnerUserId } } },
          status: InvestmentStatus.CONFIRMED,
        },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (investments.length === 0)
        throw new BadRequestException('No eligible investors found.');

      const totalAssetValue = Number(investments[0].asset.totalValue);
      const batchId = `BATCH-${Date.now()}`;

      const distributionPromises = investments.map(async (inv) => {
        const userYield = totalAmount * (Number(inv.amount) / totalAssetValue);

        // ✅ LOGIC CHANGE: Save as PENDING. Do NOT credit the wallet yet.
        const entry = manager.create(Distribution, {
          asset: inv.asset,
          investor: inv.investor,
          amount: userYield,
          period: new Date().toISOString(),
          status: PayoutStatus.PENDING, // PayoutStatus from your Enum
          batchId: batchId,
        });
        return manager.save(entry);
      });

      await Promise.all(distributionPromises);
      return { success: true, batchId, status: 'PENDING_APPROVAL' };
    });
  }

  async approveDistributionBatch(batchId: string) {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Fetch all pending payouts for this batch
      const pendingPayouts = await manager.find(Distribution, {
        where: { batchId, status: PayoutStatus.PENDING },
        relations: ['investor', 'investor.user', 'asset'],
      });

      if (pendingPayouts.length === 0)
        throw new NotFoundException('No pending payouts found for this batch.');

      // 2. Execute the actual money movement
      const payoutPromises = pendingPayouts.map(async (payout) => {
        // ✅ ACTUAL CREDIT HAPPENS HERE
        await this.walletService.creditEarned(
          payout.investor.user.id,
          payout.amount,
          LedgerSource.DISTRIBUTION,
          `Yield Approved: ${payout.asset.title}`,
          manager,
        );

        // 3. Update status to APPROVED
        payout.status = PayoutStatus.PAID;
        return manager.save(payout);
      });

      await Promise.all(payoutPromises);
      return { success: true, message: 'Batch processed successfully' };
    });
  }

  /**
   * Groups pending distributions by batchId so the Admin sees "Events" rather than 1000s of rows
   */
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

  /**
   * Deletes or marks a batch as REJECTED so the Partner can try again
   */
  async rejectDistributionBatch(batchId: string, reason: string) {
    // You can either delete them or update status to 'REJECTED'
    // Deleting is often cleaner for "Draft" corrections
    return await this.distributionRepo.delete({
      batchId,
      status: PayoutStatus.PENDING,
    });
  }
}
