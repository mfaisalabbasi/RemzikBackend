import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
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
import { Distribution } from '../distribution/distribution.entity';

@Injectable()
export class InvestmentService {
  private readonly logger = new Logger(InvestmentService.name);

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: TypeORM.Repository<Investment>,

    @InjectRepository(AssetToken)
    private readonly assettokenRepo: TypeORM.Repository<AssetToken>,

    @InjectRepository(Distribution)
    private readonly distributionRepo: TypeORM.Repository<Distribution>,

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

        token.availableShares = Number(token.availableShares) - preciseShares;
        await manager.save(token);

        const asset = await manager.findOne(Asset, {
          where: { id: dto.assetId },
          relations: ['partner', 'partner.user'],
        });
        if (!asset) throw new BadRequestException('Asset not found');

        if (settlementMode === SettlementMode.ON_CHAIN) {
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

          let investment: Investment;
          try {
            const existingInvestment = await manager.findOne(Investment, {
              where: { txHash: dto.txHash },
            });

            if (existingInvestment) {
              existingInvestment.status = InvestmentStatus.CONFIRMED;
              investment = await manager.save(existingInvestment);
            } else {
              investment = manager.create(Investment, {
                investor,
                asset: { id: dto.assetId } as Asset,
                amount: dto.amount,
                units: preciseShares,
                unitPriceAtPurchase: Number(token.sharePrice),
                status: InvestmentStatus.CONFIRMED,
                txHash: dto.txHash,
              });
              investment = await manager.save(investment);
            }
          } catch (err: any) {
            if (
              err.code === '23505' ||
              err.message?.includes('unique constraint')
            ) {
              this.logger.warn(
                `⚠️ Concurrent write detected for txHash ${dto.txHash}. Fetching existing record.`,
              );
              const concurrentExisting = await manager.findOne(Investment, {
                where: { txHash: dto.txHash },
              });
              if (!concurrentExisting) throw err;
              investment = concurrentExisting;
            } else {
              throw err;
            }
          }

          return investment;
        } else {
          const investment = manager.create(Investment, {
            investor,
            asset: { id: dto.assetId } as Asset,
            amount: dto.amount,
            units: preciseShares,
            unitPriceAtPurchase: Number(token.sharePrice),
            status: InvestmentStatus.PENDING,
          });

          const createdInvestment = await manager.save(investment);

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
          lock: { mode: 'pessimistic_write' },
        });

        if (!investment || investment.status === InvestmentStatus.CONFIRMED)
          return null;

        const fullInvestment = await manager.findOne(Investment, {
          where: { id: investmentId },
          relations: [
            'asset',
            'asset.partner',
            'asset.partner.user',
            'investor',
            'investor.user',
          ],
        });

        if (!fullInvestment) return null;

        const asset = fullInvestment.asset;
        await this.walletService.transfer(
          fullInvestment.investor.user.id,
          asset.partner.user.id,
          fullInvestment.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Investment Finalized: ${asset.title}`,
          manager,
        );

        asset.funded = Number(asset.funded) + Number(fullInvestment.amount);
        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: fullInvestment.investor.id, assetId: asset.id },
        });
        if (!existingOwnership) asset.investors = (asset.investors || 0) + 1;
        await manager.save(asset);

        await this.ownershipService.addShares(
          fullInvestment.investor,
          asset,
          fullInvestment.units,
          manager,
        );

        fullInvestment.status = InvestmentStatus.CONFIRMED;
        fullInvestment.txHash = txHash;
        return await manager.save(fullInvestment);
      },
    );

    if (confirmedInvestment) {
      const reloaded = await this.investmentRepo.findOne({
        where: { id: confirmedInvestment.id },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (reloaded) {
        await this.notificationOrchestrator.buildAndSave(
          reloaded.investor.user.id,
          'investment.created',
          {
            title: 'Investment Confirmed!',
            message: `Your investment of SAR ${reloaded.amount} in "${reloaded.asset.title}" is now finalized.`,
            amount: reloaded.amount,
            asset: reloaded.asset.title,
            timestamp: new Date(),
          },
        );
      }
    }
  }

  async handleInvestmentFailure(
    investmentId: string,
    reason: string,
  ): Promise<void> {
    await this.investmentRepo.manager.transaction(async (manager) => {
      const investment = await manager.findOne(Investment, {
        where: { id: investmentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (investment && investment.status !== InvestmentStatus.FAILED) {
        const fullInvestment = await manager.findOne(Investment, {
          where: { id: investmentId },
          relations: ['investor', 'investor.user', 'asset'],
        });

        if (fullInvestment && fullInvestment.asset) {
          const token = await manager.findOne(AssetToken, {
            where: { asset: { id: fullInvestment.asset.id } },
          });
          if (token) {
            token.availableShares =
              Number(token.availableShares) + Number(fullInvestment.units);
            await manager.save(token);
          }
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

  async getMyInvestments(userId: string): Promise<any[]> {
    const investments = await this.investmentRepo.find({
      where: { investor: { user: { id: userId } } },
      relations: ['asset', 'investor', 'investor.user'],
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      investments.map(async (inv) => {
        this.logger.debug(
          `🔍 Checking distributions for assetId: ${inv.asset?.id}, investorId: ${inv.investor?.id}`,
        );

        // Match latest distribution record with populated proof or fallback to latest by date
        const activeDist =
          inv.asset?.id && inv.investor?.id
            ? await this.distributionRepo.findOne({
                where: {
                  asset: { id: inv.asset.id },
                  investor: { id: inv.investor.id },
                },
                order: { createdAt: 'DESC' },
              })
            : null;

        this.logger.debug(`📦 Query result: ${JSON.stringify(activeDist)}`);

        // Ensure merkleProof deserializes properly from JSON/JSONB
        const merkleProof = Array.isArray(activeDist?.merkleProof)
          ? activeDist.merkleProof
          : typeof activeDist?.merkleProof === 'string'
            ? JSON.parse(activeDist.merkleProof)
            : [];

        // Structured distribution object so frontend receives nested state cleanly
        const distributionObj = activeDist
          ? {
              batchId: activeDist.batchId || null,
              distributionMode: activeDist.distributionMode || 'ON_CHAIN',
              merkleProof,
              status: activeDist.status,
            }
          : undefined;

        return {
          ...inv,
          assetTitle: inv.asset?.title,
          amountInvested: inv.amount,
          roi: (inv.asset as any)?.targetRoi || 12.5,
          image: (inv.asset as any)?.imageUrl,
          distributionMode:
            activeDist?.distributionMode ||
            (inv.investor as any)?.distributionMode ||
            'ON_CHAIN',
          batchId: activeDist?.batchId || null,
          status: inv.status, // 🔒 Strict raw investment status preservation
          merkleProof,
          distribution: distributionObj,
        };
      }),
    );
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

    const assetToken = await this.assettokenRepo.findOne({
      where: { asset: { id: investment.asset.id } },
    });
    const decimals = (assetToken as any)?.decimals || 18;

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

  async getLiveStatus(id: string) {
    const investment = await this.investmentRepo.findOne({
      where: { id },
      select: ['id', 'status'],
    });

    if (!investment) {
      throw new NotFoundException(`Investment with ID ${id} not found`);
    }

    return investment;
  }
}
