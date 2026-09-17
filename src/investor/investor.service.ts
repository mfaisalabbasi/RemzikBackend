import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { InvestorProfile } from './investor.entity';
import { User } from '../user/user.entity';
import { Ownership } from '../ownership/ownership.entity';
import {
  Distribution,
  DistributionMode,
} from '../distribution/distribution.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { InvestmentService } from 'src/investment/investment.service';
import { InvestmentStatus } from 'src/investment/enums/investment-status.enum';
import { LedgerService } from 'src/ledger/ledger.service';
import { TradeService } from 'src/secondary-market/trade/trade.service';

@Injectable()
export class InvestorService {
  constructor(
    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,

    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,

    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,

    private readonly walletService: WalletService,
    private readonly investmentService: InvestmentService,
    private readonly ledgerService: LedgerService,
    private readonly tradeService: TradeService,
  ) {}

  async getSecondaryMarketPositions(userId: string) {
    const profile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
    });

    if (!profile) throw new NotFoundException('Investor profile not found');

    const holdings = await this.ownershipRepo.find({
      where: { investorId: profile.id },
      relations: ['asset'],
    });

    return holdings.map((h) => ({
      id: h.id,
      assetId: h.assetId,
      assetTitle: h.asset?.title || 'Real Estate Unit',
      image:
        (h.asset as any).image ||
        (h.asset as any).imageUrl ||
        '/slider/real-estate.jpg',
      quantity: Number(h.units),
      avgPrice: 0,
      pnl: 0,
      tokenAddress: h.asset?.tokenAddress || '',
    }));
  }

  async createProfile(
    userId: string,
    manager?: EntityManager,
  ): Promise<InvestorProfile> {
    const repo = manager
      ? manager.getRepository(InvestorProfile)
      : this.investorRepo;

    const existing = await repo.findOne({
      where: { user: { id: userId } },
    });

    if (existing) throw new BadRequestException('Profile exists');

    const profile = repo.create({ user: { id: userId } as User });
    return repo.save(profile);
  }

  async getMyProfile(userId: string): Promise<InvestorProfile> {
    const profile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  // ✅ UPDATED: Strict admin batchId check, structured distribution sync & explicit distStatus exposure
  async getProfileData(userId: string) {
    const profile = await this.getMyProfile(userId);
    const investments = await this.investmentService.getMyInvestments(userId);
    const profileRecord = await this.investorRepo.findOne({
      where: { user: { id: userId } },
    });

    const distRecords = profileRecord
      ? await this.distributionRepo.find({
          where: { investor: { id: profileRecord.id } },
          relations: ['asset'],
          order: { createdAt: 'DESC' },
        })
      : [];

    const confirmed = investments.filter(
      (inv) => inv.status === InvestmentStatus.CONFIRMED,
    );

    const totalInvested = confirmed.reduce(
      (sum, inv) => sum + Number(inv.amount),
      0,
    );

    return {
      id: profile.user.id,
      name: profile.user.name,
      email: profile.user.email,
      distributionMode: profile.distributionMode || 'OFF_CHAIN',
      totalInvested,
      portfolioValue: totalInvested,
      activeInvestments: investments.length,
      investments: investments.map((inv) => {
        const invAssetId = inv.asset?.id || inv.assetId;
        const matchingDist = distRecords.find(
          (d) =>
            d.distributionMode === 'ON_CHAIN' &&
            d.status !== 'PAID' &&
            ((invAssetId && d.asset?.id === invAssetId) ||
              (inv.batchId && d.batchId === inv.batchId) ||
              (inv.distribution?.batchId &&
                d.batchId === inv.distribution.batchId)),
        );

        const effectiveDist = matchingDist
          ? {
              batchId: matchingDist.batchId || inv.distribution?.batchId,
              distributionMode: matchingDist.distributionMode || 'ON_CHAIN',
              merkleProof:
                matchingDist.merkleProof || inv.distribution?.merkleProof || [],
              status: matchingDist.status,
            }
          : inv.distribution;

        const resolvedStatus = effectiveDist?.status || inv.status;

        return {
          id: inv.id,
          assetTitle: inv.assetTitle || inv.asset?.title || 'Asset',
          amountInvested: Number(inv.amount),
          status: resolvedStatus,
          distStatus: resolvedStatus, // Explicitly exposed for frontend destructuring
          image: inv.image || inv.asset?.imageUrl || '/slider/real-estate.jpg',
          roi: inv.roi,
          batchId: effectiveDist?.batchId || inv.batchId || undefined,
          distributionMode:
            effectiveDist?.distributionMode ||
            profile.distributionMode ||
            inv.distributionMode ||
            'OFF_CHAIN',
          merkleProof: effectiveDist?.merkleProof || inv.merkleProof || [],
          distribution: effectiveDist,
        };
      }),
    };
  }

  async updateProfile(
    userId: string,
    data: { name?: string; email?: string; distributionMode?: string },
  ) {
    const userRepo = this.investorRepo.manager.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (data.name) user.name = data.name;
    if (data.email) user.email = data.email;
    await userRepo.save(user);

    const profile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
    });

    if (profile && data.distributionMode) {
      profile.distributionMode = data.distributionMode as any;
      await this.investorRepo.save(profile);
    }

    return {
      message: 'Profile updated',
      distributionMode: profile?.distributionMode,
    };
  }

  async getDashboard(userId: string) {
    const wallet = await this.walletService.getWallet(userId);
    const investments = await this.investmentService.getMyInvestments(userId);
    const trades = await this.tradeService.getUserTrades(userId);

    const confirmed = investments.filter(
      (inv) => inv.status === InvestmentStatus.CONFIRMED,
    );

    const investmentActivity = investments.map((inv) => ({
      title: `Investment: ${inv.asset?.title || 'Asset'}`,
      date: inv.createdAt,
      amount: -Number(inv.amount),
      status: inv.status,
      type: 'PRIMARY',
    }));

    const tradeActivity = trades.map((trade) => {
      const isBuyer = trade.buyer.user.id === userId;
      return {
        title: isBuyer
          ? `Bought: ${trade.asset?.title || 'Shares'}`
          : `Sold: ${trade.asset?.title || 'Shares'}`,
        date: trade.executedAt || trade.createdAt,
        amount: isBuyer ? -Number(trade.totalPrice) : Number(trade.totalPrice),
        status: trade.status,
        type: 'SECONDARY',
      };
    });

    const allActivity = [...investmentActivity, ...tradeActivity]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

    return {
      walletBalance: wallet.availableBalance,
      portfolioValue: confirmed.reduce(
        (sum, inv) => sum + Number(inv.amount),
        0,
      ),
      activeInvestments: confirmed.length,
      recentActivity: allActivity,
    };
  }
}
