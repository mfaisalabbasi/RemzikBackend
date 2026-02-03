import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment } from './investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { InvestmentStatus } from './enums/investment-status.enum';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { OwnershipService } from 'src/ownership/ownership.service';

@Injectable()
export class InvestmentService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,

    @InjectRepository(AssetToken)
    private readonly assettokenRepo: Repository<AssetToken>,

    private readonly ownershipService: OwnershipService,
  ) {}

  /**
   * Create investment intent (Primary Market)
   */
  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    return this.investmentRepo.manager.transaction(async (manager) => {
      // 1️⃣ Load investor
      const investor = await manager.findOne(InvestorProfile, {
        where: { user: { id: userId } },
        relations: ['user'],
      });

      if (!investor) {
        throw new BadRequestException('Investor profile required');
      }

      // 2️⃣ Lock AssetToken row ONLY (no joins!)
      const token = await manager
        .getRepository(AssetToken)
        .createQueryBuilder('token')
        .setLock('pessimistic_write')
        .where('token.assetId = :assetId', { assetId: dto.assetId })
        .getOne();

      if (!token) {
        throw new BadRequestException('Asset not tokenized');
      }

      // 3️⃣ Load asset explicitly
      const asset = await manager.findOne(Asset, {
        where: { id: dto.assetId },
      });

      if (!asset) {
        throw new BadRequestException('Asset not found');
      }

      // 4️⃣ Calculate shares
      const sharesToBuy = dto.amount / Number(token.sharePrice);

      if (sharesToBuy <= 0) {
        throw new BadRequestException('Invalid investment amount');
      }

      if (sharesToBuy > token.availableShares) {
        throw new BadRequestException('Not enough shares available');
      }

      // 5️⃣ Deduct shares
      token.availableShares -= sharesToBuy;
      await manager.save(token);

      // 6️⃣ Create investment record
      const investment = manager.create(Investment, {
        investor,
        asset,
        amount: dto.amount,
        status: InvestmentStatus.PENDING,
      });

      return manager.save(investment);
    });
  }

  /**
   * Confirm investment (after payment success)
   */
  async confirmInvestment(id: string): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: { id },
      relations: ['investor', 'asset'],
    });

    if (!investment) {
      throw new NotFoundException('Investment not found');
    }

    if (investment.status === InvestmentStatus.CONFIRMED) {
      return investment; // idempotent safety
    }

    investment.status = InvestmentStatus.CONFIRMED;

    const token = await this.assettokenRepo.findOne({
      where: { asset: { id: investment.asset.id } },
    });

    if (!token) {
      throw new BadRequestException('Token not found for asset');
    }

    const shares = investment.amount / Number(token.sharePrice);

    await this.ownershipService.addShares(
      investment.investor,
      investment.asset,
      shares,
    );

    return this.investmentRepo.save(investment);
  }

  /**
   * Investor portfolio
   */
  async getMyInvestments(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investor: { user: { id: userId } } },
      relations: ['asset'],
    });
  }

  // -------------------- Analytics --------------------

  // Get all investments by a user
  async getByUser(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investor: { id: userId } },
      relations: ['investor', 'asset'],
    });
  }

  // Get total raised for a specific asset
  async getTotalByAsset(assetId: string): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('SUM(investment.amount)', 'total')
      .where('investment.assetId = :assetId', { assetId })
      .getRawOne();

    return Number(result?.total) || 0;
  }

  // Get total invested by all users
  async getTotalInvested(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('SUM(investment.amount)', 'total')
      .getRawOne();

    return Number(result?.total) || 0;
  }
}
