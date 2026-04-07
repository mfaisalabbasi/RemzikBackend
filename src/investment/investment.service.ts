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

@Injectable()
export class InvestmentService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,

    @InjectRepository(AssetToken)
    private readonly assettokenRepo: Repository<AssetToken>,

    private readonly ownershipService: OwnershipService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * PRIMARY MARKET INVESTMENT
   * Process: Checks balance -> Deducts Wallet -> Updates Token Supply ->
   * Updates Asset Aggregates (Funded/Investors) -> Creates Investment Record ->
   * Updates Ownership Table.
   */
  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    // 1️⃣ FAST-FAIL CHECK
    const availableBalance = await this.walletService.getBalance(userId);
    if (availableBalance < dto.amount) {
      throw new BadRequestException(
        `Insufficient balance. Required: SAR ${dto.amount.toLocaleString()}. Available: SAR ${availableBalance.toLocaleString()}.`,
      );
    }

    return this.investmentRepo.manager.transaction(
      async (manager: EntityManager) => {
        // 2️⃣ LOAD INVESTOR
        const investor = await manager.findOne(InvestorProfile, {
          where: { user: { id: userId } },
          relations: ['user'],
        });
        if (!investor)
          throw new BadRequestException('Investor profile not found');

        // 3️⃣ LOCK ASSET TOKEN & ASSET: Pessimistic write lock to prevent race conditions
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

        // 4️⃣ SHARE CALCULATION
        const sharesToBuy = dto.amount / Number(token.sharePrice);
        if (sharesToBuy > token.availableShares) {
          throw new BadRequestException(
            'Not enough shares available for this purchase',
          );
        }

        // 5️⃣ FINANCIAL HANDSHAKE
        await this.walletService.debitAvailable(userId, dto.amount);
        await this.walletService.credit(
          userId,
          -dto.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Investment in ${asset.title} (Primary Market)`,
        );

        // 6️⃣ UPDATE TOKEN SUPPLY
        token.availableShares -= sharesToBuy;
        await manager.save(token);

        // 7️⃣ 🔥 SYNC ASSET AGGREGATES (The Fix for 0% Funded)
        // Increment total funded amount
        asset.funded = Number(asset.funded) + Number(dto.amount);

        // Check if this is a new investor for this specific asset to increment count
        // For simplicity, we increment; for strictness, check Ownership table first.
        asset.investors = (asset.investors || 0) + 1;
        await manager.save(asset);

        // 8️⃣ CREATE INVESTMENT RECORD
        const investment = manager.create(Investment, {
          investor,
          asset,
          amount: dto.amount,
          status: InvestmentStatus.CONFIRMED,
        });
        const savedInvestment = await manager.save(investment);

        // 9️⃣ UPDATE OWNERSHIP
        await this.ownershipService.addShares(investor, asset, sharesToBuy);

        return savedInvestment;
      },
    );
  }

  /**
   * ADMIN CONFIRMATION: Manual flow updates.
   * Now also updates the Asset Aggregate totals upon manual confirmation.
   */
  async confirmInvestment(id: string): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: { id },
      relations: ['investor', 'asset'],
    });

    if (!investment) throw new NotFoundException('Investment record not found');
    if (investment.status === InvestmentStatus.CONFIRMED) return investment;

    // Use transaction for manual confirmation to ensure Asset table stays in sync
    return this.investmentRepo.manager.transaction(async (manager) => {
      investment.status = InvestmentStatus.CONFIRMED;

      const token = await manager.findOne(AssetToken, {
        where: { asset: { id: investment.asset.id } },
      });

      if (!token)
        throw new BadRequestException('Token metadata missing for asset');

      const shares = investment.amount / Number(token.sharePrice);

      // Update Asset Totals
      const asset = investment.asset;
      asset.funded = Number(asset.funded) + Number(investment.amount);
      asset.investors = (asset.investors || 0) + 1;

      await manager.save(asset);
      await manager.save(investment);

      // Synchronize to the Ownership table
      await this.ownershipService.addShares(
        investment.investor,
        investment.asset,
        shares,
      );

      return investment;
    });
  }

  /**
   * PORTFOLIO RETRIEVAL
   */
  async getMyInvestments(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investor: { user: { id: userId } } },
      relations: ['asset'],
      order: { createdAt: 'DESC' },
    });
  }

  // -------------------- ANALYTICS & STATS --------------------

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

  async getTotalInvested(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('SUM(investment.amount)', 'total')
      .where('investment.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    return Number(result?.total) || 0;
  }
}
