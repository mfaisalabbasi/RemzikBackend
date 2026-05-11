import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, MoreThan } from 'typeorm';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { PayoutStatus } from './enums/payout-status.enum';
import { Investment } from 'src/investment/investment.entity';
import { AssetIncome } from 'src/asset/asset-income.entity';

@Injectable()
export class DistributionService {
  /**
   * CONFIG: Remzik Platform Fee (1%)
   * In a trillion-dollar empire, every transaction fuels the ecosystem.
   */
  private readonly PLATFORM_FEE_PERCENT = 0.01;

  /**
   * CONFIG: The central treasury account where platform fees are collected.
   */
  private readonly ADMIN_WALLET_USER_ID = 'SYSTEM_REVENUE_ACCOUNT';

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * ✅ THE FINTECH ENTRY POINT
   * Partners trigger payouts by referencing a specific Income Report.
   * This ensures every payout is backed by real-world asset performance.
   */
  async triggerDistributionFromIncome(incomeId: string, partnerUserId: string) {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Fetch and validate the specific income record
      const income = await manager.findOne(AssetIncome, {
        where: {
          id: incomeId,
          asset: { partner: { user: { id: partnerUserId } } },
        },
        relations: ['asset', 'asset.partner', 'asset.partner.user'],
      });

      if (!income) {
        throw new NotFoundException(
          'Income record not found or unauthorized access.',
        );
      }

      if (income.isDistributed) {
        throw new BadRequestException(
          'This revenue has already been distributed to investors.',
        );
      }

      // 2. Lock the income record to prevent double-spending/double-payouts
      income.isDistributed = true;
      await manager.save(income);

      // 3. Chain to the yield distribution logic
      // We pass the manager to ensure this all happens in ONE atomic transaction
      return this.triggerYieldDistribution(
        partnerUserId,
        income.asset.id,
        Number(income.netAmount),
        manager,
      );
    });
  }

  /**
   * CORE DISTRIBUTION LOGIC
   * Calculates pro-rata shares for all beneficial owners.
   */
  async triggerYieldDistribution(
    partnerUserId: string,
    assetId: string,
    totalAmount: number,
    existingManager?: EntityManager,
  ) {
    const work = async (manager: EntityManager) => {
      // 1. SOLVENCY GUARD: Verify Partner has the cash available in their wallet
      const partnerBalance =
        await this.walletService.getAvailableBalance(partnerUserId);
      if (partnerBalance < totalAmount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Needed: SAR ${totalAmount}, Available: SAR ${partnerBalance}.`,
        );
      }

      // 2. SNAPSHOT OWNERSHIP: Find everyone holding units at this exact moment
      const currentHolders = await manager.find(Ownership, {
        where: {
          assetId: assetId,
          units: MoreThan(0),
        },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (currentHolders.length === 0) {
        throw new BadRequestException(
          'No eligible investors found for this asset.',
        );
      }

      const totalUnitsCirculating = currentHolders.reduce(
        (sum, h) => sum + Number(h.units),
        0,
      );

      const batchId = `BATCH-${Date.now()}-${assetId.substring(0, 4)}`;

      // 3. CREATE PENDING DISTRIBUTION RECORDS
      // These will stay PENDING until the Admin approves the batch
      const distributionPromises = currentHolders.map(async (holder) => {
        const userShareOfUnits = Number(holder.units) / totalUnitsCirculating;
        const grossUserYield = totalAmount * userShareOfUnits;

        return manager.save(
          manager.create(Distribution, {
            asset: holder.asset,
            investor: holder.investor,
            amount: grossUserYield, // Gross amount before fees
            period: new Date().toISOString(),
            status: PayoutStatus.PENDING,
            batchId: batchId,
          }),
        );
      });

      await Promise.all(distributionPromises);

      return {
        success: true,
        batchId,
        status: 'PENDING_ADMIN_APPROVAL',
        totalGrossAmount: totalAmount,
        investorCount: currentHolders.length,
      };
    };

    return existingManager
      ? work(existingManager)
      : await this.dataSource.transaction(work);
  }

  /**
   * THE SETTLEMENT ENGINE
   * Once Admin approves, money moves across the ecosystem.
   */
  async approveDistributionBatch(batchId: string) {
    return await this.dataSource.transaction(async (manager) => {
      const pendingPayouts = await manager.find(Distribution, {
        where: { batchId, status: PayoutStatus.PENDING },
        relations: [
          'investor',
          'investor.user',
          'asset',
          'asset.partner',
          'asset.partner.user',
        ],
      });

      if (pendingPayouts.length === 0) {
        throw new NotFoundException('Batch not found or already processed.');
      }

      const partnerUserId = pendingPayouts[0].asset.partner.user.id;
      const assetTitle = pendingPayouts[0].asset.title;

      // 1. CALCULATE TOTALS & FEES
      const totalGrossAmount = pendingPayouts.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      const platformFee = totalGrossAmount * this.PLATFORM_FEE_PERCENT;
      const totalNetToInvestors = totalGrossAmount - platformFee;

      // 2. DEBIT THE PARTNER (Source of Funds)
      await this.walletService.debitAvailable(
        partnerUserId,
        totalGrossAmount,
        manager,
      );

      // Log the debit in the ledger
      await this.walletService.credit(
        partnerUserId,
        0, // Transaction record
        LedgerSource.DISTRIBUTION,
        `DEBIT: Yield Payout for ${assetTitle}`,
        manager,
      );

      // 3. CREDIT THE REMZIK TREASURY (Platform Revenue)
      if (platformFee > 0) {
        await this.walletService.credit(
          this.ADMIN_WALLET_USER_ID,
          platformFee,
          LedgerSource.DISTRIBUTION,
          `REVENUE: 1% Fee from ${assetTitle} Distribution`,
          manager,
        );
      }

      // 4. CREDIT INVESTORS (Net Payouts)
      const payoutPromises = pendingPayouts.map(async (payout) => {
        const individualNetYield =
          Number(payout.amount) * (1 - this.PLATFORM_FEE_PERCENT);

        await this.walletService.creditEarned(
          payout.investor.user.id,
          individualNetYield,
          LedgerSource.DISTRIBUTION,
          `CREDIT: Yield from ${assetTitle} (Net of Platform Fee)`,
          manager,
        );

        // Update record to final state
        payout.status = PayoutStatus.PAID;
        payout.amount = individualNetYield;
        return manager.save(payout);
      });

      await Promise.all(payoutPromises);

      return {
        success: true,
        summary: {
          totalGross: totalGrossAmount,
          remzikRevenue: platformFee,
          netInvestorPayout: totalNetToInvestors,
          batchId: batchId,
        },
      };
    });
  }

  /**
   * ADMIN DASHBOARD QUERY
   * Fetches all batches waiting for manual verification.
   */
  async getGlobalPendingBatches() {
    return this.dataSource.query(`
      SELECT 
        d."batchId", 
        a."title" as "assetName",
        d."period",
        COUNT(d.id) as "investorCount", 
        SUM(d.amount) as "totalGrossAmount",
        MIN(d."createdAt") as "requestedAt"
      FROM distributions d
      JOIN assets a ON d."assetId" = a.id
      WHERE d.status = 'PENDING'
      GROUP BY d."batchId", a."title", d."period"
      ORDER BY "requestedAt" ASC
    `);
  }

  /**
   * REJECTION LOGIC
   * If the Admin sees an error, they can wipe the batch and let the partner try again.
   */
  async rejectDistributionBatch(batchId: string, reason: string) {
    // Note: In a production 'Empire', you'd likely update the status to 'REJECTED'
    // and log the 'reason' instead of deleting.
    return await this.distributionRepo.delete({
      batchId,
      status: PayoutStatus.PENDING,
    });
  }
}
