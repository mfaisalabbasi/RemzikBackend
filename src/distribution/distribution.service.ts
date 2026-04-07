import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { Asset } from '../asset/asset.entity';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';

@Injectable()
export class DistributionService {
  constructor(
    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,
    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,
    @InjectRepository(AssetToken)
    private readonly assetTokenRepo: Repository<AssetToken>,
    private readonly walletService: WalletService, // Added to pay investors
  ) {}

  /**
   * Calculate and pay out income (Rent/Dividends) to all shareholders
   */
  async distributeIncome(
    asset: Asset,
    totalIncome: number,
    period: string, // e.g., "March 2026"
  ): Promise<void> {
    return this.distributionRepo.manager.transaction(
      async (manager: EntityManager) => {
        // 1. Get Asset Token details to know total shares
        const token = await manager.findOne(AssetToken, {
          where: { asset: { id: asset.id } },
        });
        if (!token) throw new BadRequestException('Asset metadata not found');

        // 2. Find everyone who owns a piece of this asset
        const ownerships = await manager.find(Ownership, {
          where: { assetId: asset.id },
          relations: ['investor', 'investor.user'],
        });

        if (!ownerships.length)
          throw new BadRequestException('No investors found for this asset');

        for (const ownership of ownerships) {
          // 3. Math: (My Shares / Total Shares) * Total Income
          const shareRatio =
            Number(ownership.shares) / Number(token.totalShares);
          const payoutAmount = totalIncome * shareRatio;

          if (payoutAmount <= 0) continue;

          // 4. Record the Distribution for tax/reporting
          const record = manager.create(Distribution, {
            asset,
            investor: ownership.investor,
            amount: payoutAmount,
            period,
            paid: true, // Marking true because we credit the wallet immediately
          });
          await manager.save(record);

          // 5. CREDIT WALLET: The money actually moves to the user's available balance
          const userId = ownership.investor.user.id;
          await this.walletService.credit(
            userId,
            payoutAmount,
            LedgerSource.DIVIDEND_PAYOUT,
            `Income Distribution for ${asset.title} - ${period}`,
          );
        }
      },
    );
  }
}
