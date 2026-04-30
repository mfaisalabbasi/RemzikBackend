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
    private readonly walletService: WalletService,
  ) {}

  async distributeIncome(
    asset: Asset,
    totalIncome: number,
    period: string,
  ): Promise<void> {
    return this.distributionRepo.manager.transaction(
      async (manager: EntityManager) => {
        const token = await manager.findOne(AssetToken, {
          where: { asset: { id: asset.id } },
        });
        if (!token) throw new BadRequestException('Asset metadata not found');

        const ownerships = await manager.find(Ownership, {
          where: { assetId: asset.id },
          relations: ['investor', 'investor.user'],
        });

        if (!ownerships.length)
          throw new BadRequestException('No investors found for this asset');

        for (const ownership of ownerships) {
          const shareRatio =
            Number(ownership.shares) / Number(token.totalShares);
          const payoutAmount = totalIncome * shareRatio;

          if (payoutAmount <= 0) continue;

          // 1. Record the Distribution
          const record = manager.create(Distribution, {
            asset,
            investor: ownership.investor,
            amount: payoutAmount,
            period,
            paid: true,
          });
          await manager.save(record);

          // 2. CREDIT WALLET: Using the transactional manager
          // This ensures the Ledger entry and Balance update happen together
          const userId = ownership.investor.user.id;

          await this.walletService.credit(
            userId,
            payoutAmount,
            LedgerSource.DIVIDEND_PAYOUT,
            `Income Distribution: ${asset.title} (${period})`,
            manager, // Pass the manager here!
          );
        }
      },
    );
  }
}
