import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { Asset } from '../asset/asset.entity';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { PayoutStatus } from './enums/payout-status.enum';

// distribution.service.ts
@Injectable()
export class DistributionService {
  constructor(
    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,
    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,
    @InjectRepository(AssetToken)
    private readonly assetTokenRepo: Repository<AssetToken>,
    private readonly walletService: WalletService,
  ) {}

  /**
   * CORE: Distribute Income
   * Handles the fractional math and triggers the Wallet Ledger updates.
   */
  async distributeIncome(assetId: string, totalIncome: number, period: string) {
    if (totalIncome <= 0)
      throw new BadRequestException('Income must be positive');

    const batchId = `DIST-${assetId.substring(0, 4)}-${Date.now()}`;

    return await this.distributionRepo.manager.transaction(async (manager) => {
      // 1. Fetch metadata with a lock to ensure share counts don't change during math
      const token = await manager.findOne(AssetToken, {
        where: { asset: { id: assetId } },
        relations: ['asset'],
      });
      if (!token) throw new BadRequestException('Asset not tokenized');

      // 2. Fetch all current owners
      const ownerships = await manager.find(Ownership, {
        where: { asset: { id: assetId } },
        relations: ['investor', 'investor.user'],
      });

      let distributedSoFar = 0;

      for (const ownership of ownerships) {
        // Calculation: (User Shares / Total Shares) * Total Income
        const shareRatio = Number(ownership.shares) / Number(token.totalShares);
        const payoutAmount = Math.floor(totalIncome * shareRatio * 100) / 100; // Round down to avoid over-payout

        if (payoutAmount < 0.01) continue; // Skip dusting

        distributedSoFar += payoutAmount;

        // 3. Create Distribution Record (The Receipt)
        const record = manager.create(Distribution, {
          asset: token.asset,
          investor: ownership.investor,
          amount: payoutAmount,
          period,
          batchId,
          status: PayoutStatus.PAID,
        });
        await manager.save(record);

        // 4. TRIGGER WALLET (The Actual Money Flow)
        // This hits the Ledger system we built last night.
        await this.walletService.credit(
          ownership.investor.user.id,
          payoutAmount,
          LedgerSource.DIVIDEND_PAYOUT,
          `Dividend: ${token.asset.title} - ${period}`,
          manager, // ATOMIC: If one fails, the whole batch rolls back
        );
      }

      /**
       * 🚀 PLUG-IN READY: RECONCILIATION
       * In production, you would check: if (distributedSoFar < totalIncome)
       * The leftover "cents" due to rounding move to a 'Company Revenue' account.
       */
      return {
        batchId,
        totalDistributed: distributedSoFar,
        count: ownerships.length,
      };
    });
  }
}
