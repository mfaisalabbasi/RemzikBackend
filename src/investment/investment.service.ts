import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Investment } from './investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { InvestmentStatus } from './enums/investment-status.enum';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { OwnershipService } from 'src/ownership/ownership.service';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';
import { Ownership } from 'src/ownership/ownership.entity';

@Injectable()
export class InvestmentService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,

    @InjectRepository(AssetToken)
    private readonly assettokenRepo: Repository<AssetToken>,
    private readonly notificationOrchestrator: NotificationOrchestrator,
    private readonly ownershipService: OwnershipService,
    private readonly walletService: WalletService,
  ) {}

  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    // Execute everything inside the transaction to guarantee isolation
    const savedInvestment = await this.investmentRepo.manager.transaction(
      async (manager: EntityManager) => {
        // 1. 🛡️ FIREWALL: Check balance INSIDE the transaction boundary to block double-spend
        const availableBalance =
          await this.walletService.getAvailableBalance(userId);
        if (availableBalance < dto.amount) {
          throw new BadRequestException(`Insufficient balance.`);
        }

        const investor = await manager.findOne(InvestorProfile, {
          where: { user: { id: userId } },
          relations: ['user'],
        });
        if (!investor)
          throw new BadRequestException('Investor profile not found');

        // ✅ Pessimistic Lock prevents over-subscription
        const token = await manager
          .getRepository(AssetToken)
          .createQueryBuilder('token')
          .setLock('pessimistic_write')
          .where('token.assetId = :assetId', { assetId: dto.assetId })
          .getOne();

        if (!token) throw new BadRequestException('Asset is not tokenized');

        const asset = await manager.findOne(Asset, {
          where: { id: dto.assetId },
          relations: ['partner', 'partner.user'],
        });
        if (!asset) throw new BadRequestException('Asset not found');

        // Calculate exact shares up to 4 decimal points
        const sharesToBuy = Number(dto.amount) / Number(token.sharePrice);
        const preciseShares = Math.round(sharesToBuy * 10000) / 10000;

        // Check availability within the locked transaction
        if (preciseShares > Number(token.availableShares)) {
          throw new BadRequestException(
            'Not enough shares available (Sold Out or Over-subscribed)',
          );
        }

        // ✅ UNIQUE INVESTOR CHECK
        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: investor.id, assetId: asset.id },
        });

        if (!existingOwnership) {
          asset.investors = (asset.investors || 0) + 1;
        }

        // Deduct/Transfer balances
        await this.walletService.transfer(
          userId,
          asset.partner.user.id,
          dto.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Investment for asset ${asset.title}`,
          manager,
        );

        token.availableShares = Number(token.availableShares) - preciseShares;
        await manager.save(token);

        asset.funded = Number(asset.funded) + Number(dto.amount);
        await manager.save(asset); // Persists both funded and investors metrics cleanly

        // ✅ FIXED PRECISE UNITS: Using preciseShares instead of Math.floor to match ledger
        const investment = manager.create(Investment, {
          investor,
          asset,
          amount: dto.amount,
          units: preciseShares,
          unitPriceAtPurchase: Number(token.sharePrice),
          status: InvestmentStatus.CONFIRMED,
        });

        const result = await manager.save(investment);

        // Match the ownership records exactly to the penny
        await this.ownershipService.addShares(
          investor,
          asset,
          preciseShares,
          manager,
        );

        return result;
      },
    );

    await this.notificationOrchestrator.buildAndSave(
      userId,
      'investment.created',
      {
        amount: savedInvestment.amount,
        asset: savedInvestment.asset.title,
      },
    );

    return savedInvestment;
  }

  async confirmInvestment(id: string): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: { id },
      relations: [
        'investor',
        'investor.user',
        'asset',
        'asset.partner',
        'asset.partner.user',
      ],
    });

    if (!investment) throw new NotFoundException('Investment record not found');
    if (investment.status === InvestmentStatus.CONFIRMED) return investment;

    const confirmedInvestment = await this.investmentRepo.manager.transaction(
      async (manager) => {
        investment.status = InvestmentStatus.CONFIRMED;

        const token = await manager.findOne(AssetToken, {
          where: { asset: { id: investment.asset.id } },
        });

        if (!token)
          throw new BadRequestException('Token metadata missing for asset');

        const shares = investment.amount / Number(token.sharePrice);
        const preciseShares = Math.round(shares * 10000) / 10000;

        const asset = investment.asset;

        // ✅ UNIQUE INVESTOR CHECK Explicit Save
        const existingOwnership = await manager.findOne(Ownership, {
          where: {
            investorId: investment.investor.id,
            assetId: asset.id,
          },
        });

        if (!existingOwnership) {
          asset.investors = (asset.investors || 0) + 1;
        }

        await this.walletService.transfer(
          investment.investor.user.id,
          asset.partner.user.id,
          investment.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Funding Released: ${asset.title}`,
          manager,
        );

        token.availableShares = Number(token.availableShares) - preciseShares;
        await manager.save(token);

        asset.funded = Number(asset.funded) + Number(investment.amount);
        await manager.save(asset); // Ensure asset table is saved clearly

        investment.unitPriceAtPurchase = Number(token.sharePrice);
        investment.units = preciseShares; // Avoid truncating matching anomalies

        const result = await manager.save(investment);

        await this.ownershipService.addShares(
          investment.investor,
          asset,
          preciseShares,
          manager,
        );

        return result;
      },
    );

    const userId = confirmedInvestment.investor?.user?.id;
    if (userId) {
      await this.notificationOrchestrator.buildAndSave(
        userId,
        'investment.created',
        {
          amount: confirmedInvestment.amount,
          asset: confirmedInvestment.asset.title,
        },
      );
    }

    return confirmedInvestment;
  }

  async getMyInvestments(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investor: { user: { id: userId } } },
      relations: ['asset'],
      order: { createdAt: 'DESC' },
    });
  }

  async getByUser(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investor: { user: { id: userId } } },
      relations: ['investor', 'asset'],
    });
  }

  async getTotalByAsset(assetId: string): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('SUM(investment.amount)', 'total')
      .where('investment.assetId = :assetId', { assetId })
      .andWhere('investment.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    return Number(result?.total) || 0;
  }

  async getTotalInvested(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('SUM(CAST(investment.amount AS FLOAT))', 'total')
      .where('investment.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    return result?.total ? parseFloat(result.total) : 0;
  }

  async countUniqueInvestors(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('COUNT(DISTINCT(investment.investorId))', 'count')
      .getRawOne();

    return parseInt(result?.count || '0');
  }
}
