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
import {
  CreateInvestmentDto,
  SettlementMode,
} from './dto/create-investment.dto';
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

  async getById(id: string): Promise<Investment | null> {
    return await this.investmentRepo.findOne({ where: { id } });
  }

  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    const settlementMode = dto.settlementMode || SettlementMode.OFF_CHAIN;

    if (settlementMode === SettlementMode.ON_CHAIN && !dto.txHash) {
      throw new BadRequestException(
        'Transaction hash is required for on-chain settlement.',
      );
    }

    const savedInvestment = await this.investmentRepo.manager.transaction(
      async (manager: TypeORM.EntityManager) => {
        // 1. Balance check ONLY for OFF_CHAIN mode
        if (settlementMode === SettlementMode.OFF_CHAIN) {
          const availableBalance =
            await this.walletService.getAvailableBalance(userId);
          if (availableBalance < dto.amount)
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

        const sharesToBuy = Number(dto.amount) / Number(token.sharePrice);
        const preciseShares = Math.round(sharesToBuy * 10000) / 10000;

        if (preciseShares > Number(token.availableShares))
          throw new BadRequestException('Not enough shares available');

        // Decrement available shares atomically
        token.availableShares = Number(token.availableShares) - preciseShares;
        await manager.save(token);

        const asset = await manager.findOne(Asset, {
          where: { id: dto.assetId },
          relations: ['partner', 'partner.user'],
        });
        if (!asset) throw new BadRequestException('Asset not found');

        if (settlementMode === SettlementMode.ON_CHAIN) {
          // ✅ HYBRID ON-CHAIN FLOW: User paid via Privy & TreasuryVault directly on-chain
          asset.funded = Number(asset.funded) + Number(dto.amount);

          const existingOwnership = await manager.findOne(Ownership, {
            where: { investorId: investor.id, assetId: asset.id },
          });
          if (!existingOwnership) {
            asset.investors = (asset.investors || 0) + 1;
          }
          await manager.save(asset);

          await this.ownershipService.addShares(
            investor,
            asset,
            preciseShares,
            manager,
          );

          const investment = manager.create(Investment, {
            investor,
            asset: { id: dto.assetId } as Asset,
            amount: dto.amount,
            units: preciseShares,
            unitPriceAtPurchase: Number(token.sharePrice),
            status: InvestmentStatus.CONFIRMED,
            txHash: dto.txHash,
          });

          return await manager.save(investment);
        } else {
          // 🔄 OFF_CHAIN FLOW: Standard internal balance deduction & queue processing
          const investment = manager.create(Investment, {
            investor,
            asset: { id: dto.assetId } as Asset,
            amount: dto.amount,
            units: preciseShares,
            unitPriceAtPurchase: Number(token.sharePrice),
            status: InvestmentStatus.PENDING,
          });

          const createdInvestment = await manager.save(investment);

          // PRODUCTION FIX: Unique transactionId enforces idempotency via BullMQ jobId
          await this.investmentQueue.add(
            'process-investment',
            { investmentId: createdInvestment.id },
            {
              jobId: dto.transactionId,
              attempts: 3,
              removeOnComplete: true,
            },
          );

          return createdInvestment;
        }
      },
    );

    // Send confirmation notification immediately if settled on-chain
    if (settlementMode === SettlementMode.ON_CHAIN) {
      const fullInvestment = await this.investmentRepo.findOne({
        where: { id: savedInvestment.id },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (fullInvestment) {
        await this.notificationOrchestrator.buildAndSave(
          fullInvestment.investor.user.id,
          'investment.created',
          {
            title: 'On-Chain Investment Confirmed!',
            message: `Your on-chain investment of SAR ${fullInvestment.amount} in "${fullInvestment.asset.title}" is confirmed.`,
            amount: fullInvestment.amount,
            asset: fullInvestment.asset.title,
            timestamp: new Date(),
          },
        );
      }
    }

    return savedInvestment;
  }

  async finalizeTokenization(
    investmentId: string,
    txHash: string,
  ): Promise<void> {
    const confirmedInvestment = await this.investmentRepo.manager.transaction(
      async (manager) => {
        const investment = await manager.findOne(Investment, {
          where: { id: investmentId },
          relations: [
            'asset',
            'asset.partner',
            'asset.partner.user',
            'investor',
            'investor.user',
          ],
        });

        if (!investment || investment.status === InvestmentStatus.CONFIRMED)
          return null;

        const asset = investment.asset;
        await this.walletService.transfer(
          investment.investor.user.id,
          asset.partner.user.id,
          investment.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Investment Finalized: ${asset.title}`,
          manager,
        );

        asset.funded = Number(asset.funded) + Number(investment.amount);
        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: investment.investor.id, assetId: asset.id },
        });
        if (!existingOwnership) asset.investors = (asset.investors || 0) + 1;
        await manager.save(asset);

        await this.ownershipService.addShares(
          investment.investor,
          asset,
          investment.units,
          manager,
        );

        investment.status = InvestmentStatus.CONFIRMED;
        investment.txHash = txHash;
        return await manager.save(investment);
      },
    );

    if (confirmedInvestment) {
      await this.notificationOrchestrator.buildAndSave(
        confirmedInvestment.investor.user.id,
        'investment.created',
        {
          title: 'Investment Confirmed!',
          message: `Your investment of SAR ${confirmedInvestment.amount} in "${confirmedInvestment.asset.title}" is now finalized.`,
          amount: confirmedInvestment.amount,
          asset: confirmedInvestment.asset.title,
          timestamp: new Date(),
        },
      );
    }
  }

  async handleInvestmentFailure(
    investmentId: string,
    reason: string,
  ): Promise<void> {
    await this.investmentRepo.manager.transaction(async (manager) => {
      const investment = await manager.findOne(Investment, {
        where: { id: investmentId },
        relations: ['investor', 'investor.user', 'asset'],
      });
      if (investment && investment.status !== InvestmentStatus.FAILED) {
        const token = await manager.findOne(AssetToken, {
          where: { asset: { id: investment.asset.id } },
        });
        if (token) {
          token.availableShares =
            Number(token.availableShares) + Number(investment.units);
          await manager.save(token);
        }
        investment.status = InvestmentStatus.FAILED;
        await manager.save(investment);
      }
    });
  }

  async confirmInvestment(id: string): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({ where: { id } });

    if (!investment) {
      throw new NotFoundException(`Investment with ID ${id} not found`);
    }

    await this.investmentQueue.add('process-investment', { investmentId: id });
    return investment;
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
      .createQueryBuilder('i')
      .select('SUM(i.amount)', 't')
      .where('i.assetId = :assetId AND i.status = :s', {
        assetId,
        s: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();
    return Number(result?.t) || 0;
  }

  async getTotalInvested(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('i')
      .select('SUM(CAST(i.amount AS FLOAT))', 't')
      .where('i.status = :s', { s: InvestmentStatus.CONFIRMED })
      .getRawOne();
    return result?.t ? parseFloat(result.t) : 0;
  }

  async countUniqueInvestors(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('i')
      .select('COUNT(DISTINCT(i.investorId))', 'c')
      .getRawOne();
    return parseInt(result?.c || '0');
  }

  async executeBlockchainTransfer(investmentId: string): Promise<string> {
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
      relations: ['asset', 'investor', 'investor.user'],
    });

    if (!investment) {
      throw new NotFoundException('Investment record not found');
    }

    if (
      !investment.asset?.tokenAddress ||
      !investment.asset?.treasuryAddress ||
      !investment.investor?.user?.walletAddress
    ) {
      throw new InternalServerErrorException(
        'Missing blockchain credentials or asset treasury address',
      );
    }

    // Fetch asset token decimals from DB (defaults to 18 if not explicitly set)
    const assetToken = await this.assettokenRepo.findOne({
      where: { asset: { id: investment.asset.id } },
    });
    // Fix by casting assetToken as any
    const decimals = (assetToken as any)?.decimals || 18;

    // ✅ Pass the per-asset treasury address and token decimals to transferFromTreasuryVault
    const receipt: any = await this.blockchainService.transferFromTreasuryVault(
      investment.asset.tokenAddress,
      investment.asset.treasuryAddress,
      investment.investor.user.walletAddress,
      investment.units.toString(),
      decimals,
    );

    const txHash: string = receipt.hash || receipt.transactionHash;

    if (!txHash) {
      throw new InternalServerErrorException(
        'Blockchain transfer failed to return a transaction hash.',
      );
    }

    return txHash;
  }
}
