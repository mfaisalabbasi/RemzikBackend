import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Distribution } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { Asset } from '../asset/asset.entity';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';

@Injectable()
export class DistributionService {
  constructor(
    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,

    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,

    @InjectRepository(AssetToken)
    private readonly assetTokenRepo: Repository<AssetToken>,
  ) {}

  /**
   * Distribute income for an asset
   */
  async distributeIncome(
    asset: Asset,
    totalIncome: number,
    period: string,
  ): Promise<void> {
    // 1️⃣ Get all ownerships for this asset
    const ownerships = await this.ownershipRepo.find({
      where: { asset: { id: asset.id } },
      relations: ['investor', 'asset'],
    });

    if (!ownerships || ownerships.length === 0) {
      throw new BadRequestException('No ownerships found for this asset');
    }

    // 2️⃣ Get the token record for this asset
    const token = await this.assetTokenRepo.findOne({
      where: { asset: { id: asset.id } },
    });

    if (!token) {
      throw new BadRequestException('Asset not tokenized yet');
    }

    // 3️⃣ Loop over each ownership and calculate payout
    for (const ownership of ownerships) {
      const shareRatio = Number(ownership.shares) / Number(token.totalShares);
      const payout = totalIncome * shareRatio;

      // 4️⃣ Create distribution record
      const record = this.distributionRepo.create({
        asset,
        investor: ownership.investor,
        amount: payout,
        period,
        paid: false,
      });

      await this.distributionRepo.save(record);
    }
  }
}
