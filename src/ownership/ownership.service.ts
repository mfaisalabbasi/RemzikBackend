import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Ownership } from './ownership.entity';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class OwnershipService {
  private readonly logger = new Logger(OwnershipService.name);

  constructor(
    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,

    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,

    private readonly notificationOrchestrator: NotificationOrchestrator,
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

    // 🛡️ NOTIFICATION: Inform investor of portfolio share allocation
    try {
      const activeManager = manager || this.ownershipRepo.manager;
      const investorProfile = await activeManager.findOne(InvestorProfile, {
        where: { id: investor.id },
        relations: ['user'],
      });

      if (investorProfile?.user?.id) {
        await this.notificationOrchestrator.buildAndSave(
          investorProfile.user.id,
          'ownership.shares_added',
          {
            title: 'Shares Allocated',
            message: `${shares} shares have been added to your portfolio for asset "${asset.title || asset.id}".`,
            assetId: asset.id,
            shares,
            timestamp: new Date(),
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to send shares allocation notification: ${err}`,
      );
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
      relations: ['asset'],
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

    // 🛡️ NOTIFICATION: Inform investor of units removal
    try {
      const activeManager = manager || this.ownershipRepo.manager;
      const investorProfile = await activeManager.findOne(InvestorProfile, {
        where: { id: investorId },
        relations: ['user'],
      });

      if (investorProfile?.user?.id) {
        await this.notificationOrchestrator.buildAndSave(
          investorProfile.user.id,
          'ownership.units_removed',
          {
            title: 'Units Sold / Transferred',
            message: `${units} units have been deducted from your portfolio.`,
            assetId,
            units,
            timestamp: new Date(),
          },
        );
      }
    } catch (err) {
      this.logger.error(`Failed to send units removal notification: ${err}`);
    }
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
        : (await (manager || this.ownershipRepo.manager).findOne(
            InvestorProfile,
            {
              where: { id: investor.id },
              relations: ['user'],
            },
          )) || investor;

    const ownership = await repo.findOne({
      where: { investorId: investorProfile.id, assetId },
    });

    if (ownership) {
      ownership.units = Number(ownership.units) + Number(units);
      await repo.save(ownership);
    } else {
      const newOwnership = repo.create({
        investor: investorProfile,
        investorId: investorProfile.id,
        asset: { id: assetId } as Asset,
        assetId,
        shares: Number(units),
        units: Number(units),
      });
      await repo.save(newOwnership);
    }

    // 🛡️ NOTIFICATION: Inform investor of units addition
    try {
      const userId =
        investorProfile.user?.id ||
        (typeof investor === 'string' ? investor : null);
      if (userId) {
        await this.notificationOrchestrator.buildAndSave(
          userId,
          'ownership.units_added',
          {
            title: 'Units Acquired',
            message: `${units} units have been successfully added to your portfolio.`,
            assetId,
            units,
            timestamp: new Date(),
          },
        );
      }
    } catch (err) {
      this.logger.error(`Failed to send units addition notification: ${err}`);
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
