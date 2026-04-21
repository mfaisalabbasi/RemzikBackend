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
    const availableBalance = await this.walletService.getBalance(userId);
    if (availableBalance < dto.amount) {
      throw new BadRequestException(
        `Insufficient balance. Required: SAR ${dto.amount.toLocaleString()}. Available: SAR ${availableBalance.toLocaleString()}.`,
      );
    }

    const savedInvestment = await this.investmentRepo.manager.transaction(
      async (manager: EntityManager) => {
        const investor = await manager.findOne(InvestorProfile, {
          where: { user: { id: userId } },
          relations: ['user'],
        });
        if (!investor)
          throw new BadRequestException('Investor profile not found');

        const token = await manager
          .getRepository(AssetToken)
          .createQueryBuilder('token')
          .setLock('pessimistic_write')
          .where('token.assetId = :assetId', { assetId: dto.assetId })
          .getOne();

        if (!token) throw new BadRequestException('Asset is not tokenized');

        const asset = await manager.findOne(Asset, {
          where: { id: dto.assetId },
        });
        if (!asset) throw new BadRequestException('Asset not found');

        const sharesToBuy = dto.amount / Number(token.sharePrice);
        if (sharesToBuy > token.availableShares) {
          throw new BadRequestException(
            'Not enough shares available for this purchase',
          );
        }

        await this.walletService.debitAvailable(userId, dto.amount);
        await this.walletService.credit(
          userId,
          -dto.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Investment in ${asset.title} (Primary Market)`,
        );

        token.availableShares -= sharesToBuy;
        await manager.save(token);

        asset.funded = Number(asset.funded) + Number(dto.amount);
        asset.investors = (asset.investors || 0) + 1;
        await manager.save(asset);

        const investment = manager.create(Investment, {
          investor,
          asset,
          amount: dto.amount,
          status: InvestmentStatus.CONFIRMED,
        });
        const result = await manager.save(investment);

        await this.ownershipService.addShares(investor, asset, sharesToBuy);

        return result;
      },
    );

    // Trigger Notification
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
      relations: ['investor', 'investor.user', 'asset'],
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

        const asset = investment.asset;
        asset.funded = Number(asset.funded) + Number(investment.amount);
        asset.investors = (asset.investors || 0) + 1;

        await manager.save(asset);
        const result = await manager.save(investment);

        await this.ownershipService.addShares(
          investment.investor,
          investment.asset,
          shares,
        );

        return result;
      },
    );

    const userId = confirmedInvestment.investor?.user?.id;
    if (userId) {
      // Trigger Notification
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
      where: { investor: { id: userId } },
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

  // src/investment/investment.service.ts

  async getTotalInvested(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      // We use COALESCE to avoid nulls and cast to FLOAT for the return
      .select('SUM(CAST(investment.amount AS FLOAT))', 'total')
      .where('investment.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    // Log this to your terminal so you can see the raw DB response
    console.log('--- AUM DEBUG ---');
    console.log('Raw Result from DB:', result);

    const total = result?.total ? parseFloat(result.total) : 0;
    return total;
  }

  async countUniqueInvestors(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      // We reference the 'investor' property from your Entity class
      // TypeORM automatically handles the foreign key column mapping
      .select('COUNT(DISTINCT(investment.investorId))', 'count')
      .getRawOne();

    return parseInt(result?.count || '0');
  }
}
