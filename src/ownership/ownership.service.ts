import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ownership } from './ownership.entity';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';

@Injectable()
export class OwnershipService {
  constructor(
    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,
  ) {}

  /**
   * Add shares to investor ownership
   */
  async addShares(
    investor: InvestorProfile,
    asset: Asset,
    shares: number,
  ): Promise<void> {
    let ownership = await this.ownershipRepo.findOne({
      where: {
        investor: { id: investor.id },
        asset: { id: asset.id },
      },
      relations: ['investor', 'asset'],
    });

    if (!ownership) {
      ownership = this.ownershipRepo.create({
        investor,
        asset,
        shares,
      });
    } else {
      ownership.shares = Number(ownership.shares) + Number(shares);
    }

    await this.ownershipRepo.save(ownership);
  }
}
