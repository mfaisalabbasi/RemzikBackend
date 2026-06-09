import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import * as TypeORM from 'typeorm';
import * as Bull from 'bull';

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
import { BlockchainService } from 'src/blockchain/blockchain.service';

@Injectable()
export class InvestmentService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: TypeORM.Repository<Investment>,

    @InjectRepository(AssetToken)
    private readonly assettokenRepo: TypeORM.Repository<AssetToken>,

    @InjectQueue('investment-queue')
    private readonly investmentQueue: Bull.Queue,

    private readonly notificationOrchestrator: NotificationOrchestrator,
    private readonly ownershipService: OwnershipService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    const savedInvestment = await this.investmentRepo.manager.transaction(
      async (manager: TypeORM.EntityManager) => {
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

        const sharesToBuy = Number(dto.amount) / Number(token.sharePrice);
        const preciseShares = Math.round(sharesToBuy * 10000) / 10000;

        if (preciseShares > Number(token.availableShares)) {
          throw new BadRequestException(
            'Not enough shares available (Sold Out or Over-subscribed)',
          );
        }

        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: investor.id, assetId: asset.id },
        });

        if (!existingOwnership) {
          asset.investors = (asset.investors || 0) + 1;
        }

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
        await manager.save(asset);

        const investment = manager.create(Investment, {
          investor,
          asset,
          amount: dto.amount,
          units: preciseShares,
          unitPriceAtPurchase: Number(token.sharePrice),
          status: InvestmentStatus.PENDING,
        });

        const result = await manager.save(investment);
        await this.ownershipService.addShares(
          investor,
          asset,
          preciseShares,
          manager,
        );
        return result;
      },
    );

    // Queue for background blockchain reconciliation
    await this.investmentQueue.add('process-investment', {
      investmentId: savedInvestment.id,
    });

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

        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: investment.investor.id, assetId: asset.id },
        });

        if (!existingOwnership) asset.investors = (asset.investors || 0) + 1;

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
        await manager.save(asset);

        investment.unitPriceAtPurchase = Number(token.sharePrice);
        investment.units = preciseShares;
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

  async executeBlockchainTransfer(investmentId: string): Promise<string> {
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
      relations: ['asset', 'investor', 'investor.user'],
    });

    if (!investment) throw new NotFoundException('Investment record not found');
    const tokenAddress = investment.asset?.tokenAddress;
    const userWallet = investment.investor?.user?.walletAddress;

    if (!tokenAddress)
      throw new InternalServerErrorException(`Asset lacks a contract address.`);
    if (!userWallet)
      throw new InternalServerErrorException(
        `Investor has no registered wallet.`,
      );

    return await this.blockchainService.transferFromVault(
      tokenAddress,
      userWallet,
      investment.units,
    );
  }

  async finalizeTokenization(
    investmentId: string,
    txHash: string,
  ): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.CONFIRMED,
      txHash: txHash,
    });
  }

  async handleInvestmentFailure(
    investmentId: string,
    reason: string,
  ): Promise<void> {
    await this.investmentRepo.manager.transaction(async (manager) => {
      const investment = await manager.findOne(Investment, {
        where: { id: investmentId },
        relations: ['investor', 'investor.user'],
      });

      if (investment && investment.status !== InvestmentStatus.FAILED) {
        await this.walletService.refund(
          investment.investor.user.id,
          investment.amount,
          manager,
        );
        investment.status = InvestmentStatus.FAILED;
        await manager.save(investment);
      }
    });
  }
}
