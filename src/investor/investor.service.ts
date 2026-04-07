import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvestorProfile } from './investor.entity';
import { User } from '../user/user.entity';
import { Ownership } from '../ownership/ownership.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { InvestmentService } from 'src/investment/investment.service';
import { InvestmentStatus } from 'src/investment/enums/investment-status.enum';
import { LedgerService } from 'src/ledger/ledger.service';

@Injectable()
export class InvestorService {
  constructor(
    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,

    @InjectRepository(Ownership)
    private readonly ownershipRepo: Repository<Ownership>,

    private readonly walletService: WalletService,
    private readonly investmentService: InvestmentService,
    private readonly ledgerService: LedgerService,
  ) {}

  // ✅ NEW: Bridging the Ownership table to the Market UI
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
      quantity: Number(h.units), // Maps to your 'units' column in ownership.entity
      avgPrice: 0,
      pnl: 0,
    }));
  }

  async createProfile(userId: string): Promise<InvestorProfile> {
    const existing = await this.investorRepo.findOne({
      where: { user: { id: userId } },
    });
    if (existing) throw new BadRequestException('Profile exists');
    const profile = this.investorRepo.create({ user: { id: userId } as User });
    return this.investorRepo.save(profile);
  }

  async getMyProfile(userId: string): Promise<InvestorProfile> {
    const profile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async getProfileData(userId: string) {
    const profile = await this.getMyProfile(userId);
    const investments = await this.investmentService.getMyInvestments(userId);
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
      totalInvested,
      portfolioValue: totalInvested,
      activeInvestments: confirmed.length,
      investments: confirmed.map((inv) => ({
        id: inv.id,
        assetTitle: inv.asset?.title || 'Asset',
        amountInvested: Number(inv.amount),
        status: 'Active',
      })),
    };
  }

  async updateProfile(userId: string, data: { name?: string; email?: string }) {
    const userRepo = this.investorRepo.manager.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (data.name) user.name = data.name;
    if (data.email) user.email = data.email;
    await userRepo.save(user);
    return { message: 'Profile updated' };
  }

  async getDashboard(userId: string) {
    const wallet = await this.walletService.getWallet(userId);
    const investments = await this.investmentService.getMyInvestments(userId);
    const confirmed = investments.filter(
      (inv) => inv.status === InvestmentStatus.CONFIRMED,
    );
    return {
      walletBalance: wallet.availableBalance,
      portfolioValue: confirmed.reduce(
        (sum, inv) => sum + Number(inv.amount),
        0,
      ),
      activeInvestments: confirmed.length,
      recentActivity: investments.slice(0, 5).map((inv) => ({
        title: `Investment: ${inv.asset?.title || 'Asset'}`,
        date: inv.createdAt,
        amount: -Number(inv.amount),
        status: inv.status,
      })),
    };
  }
}
