import { Injectable, BadRequestException } from '@nestjs/common';
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

    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,
  ) {}

  /**
   * Get InvestorProfile by User ID
   * Throws exception if not found
   */
  async getInvestorByUserId(userId: string): Promise<InvestorProfile> {
    const investor = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'], // ✅ ensures user relation is loaded
    });

    if (!investor) {
      throw new BadRequestException('Investor profile not found!');
    }

    return investor;
  }

  /**
   * Add shares & units to investor ownership (for investment confirmation)
   */
  async addShares(
    investor: InvestorProfile,
    asset: Asset,
    shares: number,
  ): Promise<void> {
    const ownership = await this.ownershipRepo.findOne({
      where: { investorId: investor.id, assetId: asset.id },
    });

    if (ownership) {
      ownership.shares = Number(ownership.shares) + Number(shares);
      ownership.units = Number(ownership.units) + Number(shares);
      await this.ownershipRepo.save(ownership);
    } else {
      const newOwnership = this.ownershipRepo.create({
        investor,
        investorId: investor.id,
        asset,
        assetId: asset.id,
        shares,
        units: shares,
      });
      await this.ownershipRepo.save(newOwnership);
    }
  }

  /**
   * Remove units from investor (for trade/sale)
   */
  async removeUnits(
    investorId: string,
    assetId: string,
    units: number,
  ): Promise<void> {
    const ownership = await this.ownershipRepo.findOne({
      where: { investorId, assetId },
    });

    if (!ownership) throw new BadRequestException('Ownership record not found');

    if (ownership.units < units)
      throw new BadRequestException('Insufficient units to remove');

    ownership.units = Number(ownership.units) - Number(units);

    await this.ownershipRepo.save(ownership);
  }
  /**
   * Add units to investor (for trade/buy)
   */
  async addUnits(
    investor: InvestorProfile | string,
    assetId: string,
    units: number,
  ): Promise<void> {
    const investorProfile =
      typeof investor === 'string'
        ? await this.getInvestorByUserId(investor)
        : investor;

    const ownership = await this.ownershipRepo.findOne({
      where: { investorId: investorProfile.id, assetId },
    });

    if (ownership) {
      ownership.units = Number(ownership.units) + Number(units);
      await this.ownershipRepo.save(ownership);
    } else {
      const newOwnership = this.ownershipRepo.create({
        investor: investorProfile,
        investorId: investorProfile.id,
        asset: { id: assetId } as Asset,
        assetId,
        shares: units,
        units,
      });
      await this.ownershipRepo.save(newOwnership);
    }
  }

  /**
   * Get number of units a user owns for a specific asset
   * Expects userId (safe for listing & trade)
   */
  async getUserUnitsForAsset(userId: string, assetId: string): Promise<number> {
    const investor = await this.getInvestorByUserId(userId);

    const ownership = await this.ownershipRepo.findOne({
      where: { investorId: investor.id, assetId },
    });

    return ownership?.units ?? 0;
  }
}
