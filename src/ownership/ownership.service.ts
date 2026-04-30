import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
   * Internal Helper: Switches between global repo and transactional manager.
   * This is critical for maintaining atomicity during Trades.
   */
  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Ownership) : this.ownershipRepo;
  }

  /**
   * Get InvestorProfile by User ID
   */
  async getInvestorByUserId(userId: string): Promise<InvestorProfile> {
    const investor = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!investor) {
      throw new BadRequestException('Investor profile not found!');
    }

    return investor;
  }

  /**
   * Add shares & units (For Initial Primary Market confirmation)
   */
  async addShares(
    investor: InvestorProfile,
    asset: Asset,
    shares: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);
    const ownership = await repo.findOne({
      where: { investorId: investor.id, assetId: asset.id },
    });

    if (ownership) {
      ownership.shares = Number(ownership.shares) + Number(shares);
      ownership.units = Number(ownership.units) + Number(shares);
      await repo.save(ownership);
    } else {
      const newOwnership = repo.create({
        investor,
        investorId: investor.id,
        asset,
        assetId: asset.id,
        shares: Number(shares),
        units: Number(shares),
      });
      await repo.save(newOwnership);
    }
  }

  /**
   * Remove units (For Secondary Market Sale)
   */
  async removeUnits(
    investorId: string,
    assetId: string,
    units: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);

    const ownership = await repo.findOne({
      where: { investorId, assetId },
    });

    if (!ownership) {
      throw new BadRequestException(
        `Ownership record not found for Investor: ${investorId}`,
      );
    }

    if (Number(ownership.units) < Number(units)) {
      throw new BadRequestException('Insufficient units to remove');
    }

    ownership.units = Number(ownership.units) - Number(units);
    await repo.save(ownership);
  }

  /**
   * Add units (For Secondary Market Purchase)
   */
  async addUnits(
    investor: InvestorProfile | string,
    assetId: string,
    units: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.getRepo(manager);

    const investorProfile =
      typeof investor === 'string'
        ? await this.getInvestorByUserId(investor)
        : investor;

    const ownership = await repo.findOne({
      where: { investorId: investorProfile.id, assetId },
    });

    if (ownership) {
      // Logic for existing owners
      ownership.units = Number(ownership.units) + Number(units);
      await repo.save(ownership);
    } else {
      // Logic for a fresh owner on the secondary market
      const newOwnership = repo.create({
        investor: investorProfile,
        investorId: investorProfile.id,
        asset: { id: assetId } as Asset,
        assetId,
        shares: Number(units), // Initial shares match initial units bought
        units: Number(units),
      });
      await repo.save(newOwnership);
    }
  }

  /**
   * Helper for check balance/limits
   */
  async getUserUnitsForAsset(userId: string, assetId: string): Promise<number> {
    const investor = await this.getInvestorByUserId(userId);
    const ownership = await this.ownershipRepo.findOne({
      where: { investorId: investor.id, assetId },
    });
    return ownership?.units ? Number(ownership.units) : 0;
  }
}
