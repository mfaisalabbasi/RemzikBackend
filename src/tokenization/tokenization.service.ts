import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShareStatus } from './enums/share-status.enum';
import { Repository } from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Ownership } from './entities/ownershipt.entity';
import { AssetShare } from './entities/asset-share.entity';

@Injectable()
export class TokenizationService {
  constructor(
    @InjectRepository(AssetShare)
    private shareRepo: Repository<AssetShare>,

    @InjectRepository(Ownership)
    private ownershipRepo: Repository<Ownership>,

    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,
  ) {}

  //Initialize Asset Shares (ONCE)

  async initializeShares(
    assetId: string,
    totalShares: number,
    pricePerShare: number,
  ) {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset) throw new NotFoundException('Asset not found');

    const existing = await this.shareRepo.findOne({ where: { asset } });
    if (existing) throw new BadRequestException('Shares already initialized');

    return this.shareRepo.save({
      asset,
      totalShares,
      pricePerShare,
      status: ShareStatus.ACTIVE,
    });
  }

  // Mint Shares (INVESTMENT → OWNERSHIP)

  async mintShares(investorId: string, assetId: string, shares: number) {
    const shareConfig = await this.shareRepo.findOne({
      where: { asset: { id: assetId } },
    });

    if (!shareConfig || shareConfig.status !== ShareStatus.ACTIVE) {
      throw new BadRequestException('Asset not tokenized');
    }

    const minted = await this.ownershipRepo
      .createQueryBuilder('o')
      .select('SUM(o.sharesOwned)', 'sum')
      .where('o.assetId = :assetId', { assetId })
      .getRawOne();

    const mintedShares = Number(minted.sum || 0);

    if (mintedShares + shares > shareConfig.totalShares) {
      throw new BadRequestException('Not enough shares available');
    }

    return this.ownershipRepo.save({
      investor: { id: investorId },
      asset: { id: assetId },
      sharesOwned: shares,
    });
  }
}

//LINK WITH INVESTMENT MODULE

// await this.tokenizationService.mintShares(
//   investorId,
//   assetId,
//   calculatedShares,
// );
