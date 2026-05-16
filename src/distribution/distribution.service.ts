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
   */
  private readonly PLATFORM_FEE_PERCENT = 0.01;

  /**
   * CONFIG: Central treasury account context
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
   * ✅ THE FINTECH ENTRY POINT (FIXED FOR POSTGRES LOCKING CONSTRAINTS)
   */
  async triggerDistributionFromIncome(incomeId: string, partnerUserId: string) {
    // 1. 🛡️ FIREWALL: Block execution immediately if auth context failed to pass down the ID
    if (!partnerUserId) {
      throw new BadRequestException(
        'Partner authentication identity context is missing.',
      );
    }

    return await this.dataSource.transaction(async (manager) => {
      // 2. Lock ONLY the primary income record row. No relations joined here to stay compliant with Postgres FOR UPDATE constraints.
      const income = await manager
        .getRepository(AssetIncome)
        .createQueryBuilder('income')
        .setLock('pessimistic_write')
        .where('income.id = :incomeId', { incomeId })
        .getOne();

      if (!income) {
        throw new NotFoundException('Income record not found.');
      }

      if (income.isDistributed) {
        throw new BadRequestException(
          'This revenue has already been distributed to investors.',
        );
      }

      // 3. Fetch relational records cleanly without locks to perform security ownership context validation safely
      const fullAssetContext = await manager.findOne(AssetIncome, {
        where: { id: incomeId },
        relations: ['asset', 'asset.partner', 'asset.partner.user'],
      });

      if (
        !fullAssetContext ||
        fullAssetContext.asset?.partner?.user?.id !== partnerUserId
      ) {
        throw new BadRequestException(
          'Unauthorized access: Asset partner profile ownership mismatch.',
        );
      }

      // 4. Flip state immediately inside locked scope
      income.isDistributed = true;
      await manager.save(income);

      // 5. Chain directly to the pro-rata engine using the same operational manager
      return this.triggerYieldDistribution(
        partnerUserId,
        fullAssetContext.asset.id,
        Number(income.netAmount),
        manager,
      );
    });
  }

  /**
   * CORE DISTRIBUTION LOGIC (REMAINDER BALANCED)
   */
  async triggerYieldDistribution(
    partnerUserId: string,
    assetId: string,
    totalAmount: number,
    existingManager?: EntityManager,
  ) {
    const work = async (manager: EntityManager) => {
      const partnerBalance =
        await this.walletService.getAvailableBalance(partnerUserId);
      if (partnerBalance < totalAmount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Needed: SAR ${totalAmount}, Available: SAR ${partnerBalance}.`,
        );
      }

      const currentHolders = await manager.find(Ownership, {
        where: { assetId: assetId, units: MoreThan(0) },
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

      let allocatedGrossTotal = 0;

      // SEQUENTIAL LOOP IMPLEMENTING RUNNING PENNY CALCULATION
      for (let i = 0; i < currentHolders.length; i++) {
        const holder = currentHolders[i];
        const isLastInvestor = i === currentHolders.length - 1;

        let grossUserYield = 0;

        if (isLastInvestor) {
          // The absolute last investor absorbs the fractional drifting remainder
          const rawLastYield = totalAmount - allocatedGrossTotal;
          grossUserYield = Math.round(rawLastYield * 100) / 100;
        } else {
          const userShareOfUnits = Number(holder.units) / totalUnitsCirculating;
          grossUserYield =
            Math.round(totalAmount * userShareOfUnits * 100) / 100;
          allocatedGrossTotal += grossUserYield;
        }

        await manager.save(
          manager.create(Distribution, {
            asset: holder.asset,
            investor: holder.investor,
            amount: grossUserYield,
            period: new Date().toISOString(),
            status: PayoutStatus.PENDING,
            batchId: batchId,
          }),
        );
      }

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
   * THE SETTLEMENT ENGINE (SEQUENTIAL & PENNY BALANCED)
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

      const totalGrossAmount = pendingPayouts.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );

      const platformFee =
        Math.round(totalGrossAmount * this.PLATFORM_FEE_PERCENT * 100) / 100;

      // 1. DEBIT THE PARTNER FOR THE TOTAL GROSS
      await this.walletService.debitAvailable(
        partnerUserId,
        totalGrossAmount,
        manager,
      );
      await this.walletService.credit(
        partnerUserId,
        0,
        LedgerSource.DISTRIBUTION,
        `DEBIT: Yield Payout for ${assetTitle}`,
        manager,
      );

      // 2. CREDIT SYSTEM REVENUE TREASURY
      if (platformFee > 0) {
        await this.walletService.credit(
          this.ADMIN_WALLET_USER_ID,
          platformFee,
          LedgerSource.DISTRIBUTION,
          `REVENUE: 1% Fee from ${assetTitle} Distribution`,
          manager,
        );
      }

      let distributedNetTotal = 0;
      const totalNetToInvestors =
        Math.round((totalGrossAmount - platformFee) * 100) / 100;

      // 3. SEQUENTIAL LOOP PROCESSING (NO POOL CONCURRENCY OVERHEAD)
      for (let i = 0; i < pendingPayouts.length; i++) {
        const payout = pendingPayouts[i];
        const isLastInvestor = i === pendingPayouts.length - 1;

        let individualNetYield = 0;

        if (isLastInvestor) {
          individualNetYield =
            Math.round((totalNetToInvestors - distributedNetTotal) * 100) / 100;
        } else {
          const rawNetYield =
            Number(payout.amount) * (1 - this.PLATFORM_FEE_PERCENT);
          individualNetYield = Math.round(rawNetYield * 100) / 100;
          distributedNetTotal += individualNetYield;
        }

        await this.walletService.creditEarned(
          payout.investor.user.id,
          individualNetYield,
          LedgerSource.DISTRIBUTION,
          `CREDIT: Yield from ${assetTitle} (Net of Platform Fee)`,
          manager,
        );

        payout.status = PayoutStatus.PAID;
        payout.amount = individualNetYield;
        await manager.save(payout);
      }

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

  async rejectDistributionBatch(batchId: string, reason: string) {
    return await this.distributionRepo.delete({
      batchId,
      status: PayoutStatus.PENDING,
    });
  }
}
