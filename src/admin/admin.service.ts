import { Injectable, BadRequestException } from '@nestjs/common';
import { PartnerService } from 'src/partner/partner.service';
import { AssetService } from 'src/asset/asset.service';
import { KycService } from 'src/kyc/kyc.service';
import { AuditService } from 'src/audit/audit.service';
import { AdminActionDto } from './dto/admin-action.dto';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { WalletService } from 'src/wallet/wallet.service';
import { UrgentTask } from './interfaces/urgent-task.interface';
import { ComplianceStatus } from './interfaces/compliance-status.interface';
import { LiquidityStats } from './interfaces/liquidity-stats.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Repository } from 'typeorm';
import { Investment } from 'src/investment/investment.entity';
import { InvestmentStatus } from 'src/investment/enums/investment-status.enum';
import { Trade } from 'src/secondary-market/trade/trade.entity';
import { Wallet } from 'src/wallet/wallet.entity';
import { TradeStatus } from 'src/secondary-market/trade/enums/trade-status.enum';
import { LedgerService } from 'src/ledger/ledger.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';

@Injectable()
export class AdminService {
  constructor(
    private readonly partnerService: PartnerService,
    private readonly assetService: AssetService,
    private readonly kycService: KycService,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
    private readonly ledgerService: LedgerService,
    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
  ) {}

  async getUrgentQueue(): Promise<UrgentTask[]> {
    const [pendingKyc, pendingPartners, pendingAssets] = await Promise.all([
      this.kycService.findAllPending(),
      this.partnerService.findAllPending(),
      this.assetService.findAllPending(),
    ]);

    const queue: UrgentTask[] = [];

    // 1. Map KYC Tasks
    pendingKyc.forEach((item: any) => {
      queue.push({
        id: item.id,
        type: 'KYC',
        title: `KYC Review: ${item.user?.fullName || 'New User'}`,
        priority: 'HIGH',
        createdAt: item.createdAt,
      });
    });

    // 2. Map Partner Tasks
    pendingPartners.forEach((item: any) => {
      queue.push({
        id: item.id,
        type: 'PARTNER',
        title: `Partner Onboarding: ${item.companyName || 'Corporate Entity'}`,
        priority: 'MEDIUM',
        createdAt: item.createdAt,
      });
    });

    // 3. Map Asset Tasks
    pendingAssets.forEach((item: any) => {
      queue.push({
        id: item.id,
        type: 'ASSET_REVIEW',
        title: `Asset Approval: ${item.title}`,
        priority: 'CRITICAL',
        createdAt: item.createdAt,
      });
    });

    return queue.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async handlePartnerAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE) {
      await this.partnerService.approve(dto.targetId);
    }
    if (dto.action === AdminAction.REJECT) {
      if (!dto.reason)
        throw new BadRequestException('Rejection reason is required');
      await this.partnerService.reject(dto.targetId, dto.reason);
    }
    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  async handleAssetAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE) {
      await this.assetService.approve(dto.targetId);
    }
    if (dto.action === AdminAction.FREEZE) {
      await this.assetService.freeze(dto.targetId);
    }
    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  async handleKycAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE) {
      await this.kycService.approve(dto.targetId);
    }
    if (dto.action === AdminAction.REJECT) {
      if (!dto.reason)
        throw new BadRequestException('Rejection reason is required');
      await this.kycService.reject(dto.targetId, dto.reason);
    }
    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  // src/admin/admin.service.ts

  async getDashboardPipeline() {
    return await this.assetService.getPipelineStats();
  }

  // Inside AdminService...

  async getComplianceStatus(): Promise<ComplianceStatus> {
    // Call the new method we just created
    const lastAudit = await this.auditService.findLatest();

    // Basic health check logic
    const healthStatus: 'OPTIMAL' | 'WARNING' | 'CRITICAL' = 'OPTIMAL';

    return {
      regulatoryHealth: healthStatus,
      lastAuditDate: lastAudit ? lastAudit.createdAt : null,
      issuesCount: 0,
    };
  }
  async getLiquidityStats(): Promise<LiquidityStats> {
    // In a real scenario, you'd call your WalletService to fetch live blockchain/bank balances
    // const balances = await this.walletService.getGlobalSystemBalances();

    // For now, we will provide dynamic mock data that you can link to your DB later
    return {
      systemOperational: 1250000.5, // 1.25M SAR
      poolLiquidity: 8450000.0, // 8.45M SAR
      reserveFund: 25000000.0, // 25M SAR
      healthScore: 94, // Out of 100
    };
  }

  async getInvestorsList() {
    // 1. Get all profiles and include the linked User data
    const profiles = await this.investorRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    // 2. Map the data into the format your Frontend Grid expects
    return Promise.all(
      profiles.map(async (profile) => {
        // Calculate Total AUM (Confirmed investments only)
        const investmentSum = await this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(inv.amount)', 'total')
          .where('inv.investorId = :id', { id: profile.id })
          .andWhere('inv.status = :status', {
            status: InvestmentStatus.CONFIRMED,
          })
          .getRawOne();

        return {
          id: profile.id,
          name: profile.user?.name || 'Unknown User',
          email: profile.user?.email,
          status: profile.user?.isVerified ? 'Approved' : 'Pending',
          totalAum: parseFloat(investmentSum?.total || '0'),
          joinedAt: profile.createdAt,
        };
      }),
    );
  }

  async getInvestorDetail(id: string) {
    // 1. Fetch Profile and User basics
    const profile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!profile) {
      throw new BadRequestException('Investor profile not found');
    }

    // 2. Fetch Wallet Snapshot and Ledger History in parallel for speed
    const [wallet, history] = await Promise.all([
      this.walletRepo.findOne({ where: { userId: profile.user.id } }),
      this.ledgerService.findByUser(profile.user.id),
    ]);

    // 3. Map Ledger entries with correct mathematical signs (+/-)
    const ledger = history.map((entry) => {
      // Logic for "Money Out" (Debits)
      const isOutflow =
        entry.type === LedgerType.DEBIT ||
        entry.type === LedgerType.WITHDRAWAL_REQUEST ||
        entry.type === LedgerType.WITHDRAWAL_PAID ||
        entry.source === LedgerSource.ASSET_INVESTMENT ||
        entry.source === LedgerSource.SECONDARY_MARKET_BUY ||
        entry.source === LedgerSource.ESCROW_LOCK;

      return {
        id: entry.id,
        date: entry.createdAt,
        // Use custom description if available, otherwise format the source name
        action:
          entry.description || entry.note || entry.source.replace(/_/g, ' '),
        // Crucial: Negative if outflow, Positive if inflow
        amount: isOutflow
          ? -Math.abs(Number(entry.amount))
          : Math.abs(Number(entry.amount)),
        type: this.mapSourceToMarketType(entry.source),
      };
    });

    // 4. Return unified data object
    return {
      id: profile.id,
      name: profile.user.name,
      email: profile.user.email,
      isActive: profile.user.isActive,
      status: profile.user.isVerified ? 'Approved' : 'Pending',
      availableBalance: Number(wallet?.availableBalance || 0),
      lockedBalance: Number(wallet?.lockedBalance || 0),
      totalEarned: Number(wallet?.totalEarned || 0),
      kycExpiry: '2027-05-12', // Replace with real profile.kycExpiry when added to DB
      ledger,
    };
  }

  /**
   * Helper to categorize ledger sources for the UI badges
   */
  private mapSourceToMarketType(
    source: LedgerSource,
  ): 'PRIMARY' | 'SECONDARY' | 'CASH' {
    const s = source.toString();
    if (s.includes('INVESTMENT') || s.includes('ASSET')) return 'PRIMARY';
    if (s.includes('SECONDARY')) return 'SECONDARY';
    return 'CASH';
  }

  async approveKyc(id: string) {
    const profile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!profile) throw new BadRequestException('Profile not found');

    // Update User verification status
    profile.user.isVerified = true;
    await this.investorRepo.manager.save(profile.user);

    // LOG THE ACTION IN THE AUDIT LEDGER
    await this.ledgerService.record({
      userId: profile.user.id,
      amount: 0,
      type: LedgerType.ADJUSTMENT,
      source: LedgerSource.ADMIN_ADJUSTMENT,
      description: 'KYC Approved by Admin',
      note: `Investor verified on ${new Date().toISOString()}`,
    });

    return { success: true };
  }

  async toggleAccountFreeze(id: string, reason: string) {
    const profile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!profile) throw new BadRequestException('Profile not found');

    // Now 'isActive' exists on the user object
    const currentlyActive = profile.user.isActive;
    profile.user.isActive = !currentlyActive;

    // Save the updated user status
    await this.investorRepo.manager.save(profile.user);

    // Audit Log
    await this.ledgerService.record({
      userId: profile.user.id,
      amount: 0,
      type: LedgerType.ADJUSTMENT,
      source: LedgerSource.ADMIN_ADJUSTMENT,
      description: currentlyActive
        ? `ACCOUNT FROZEN: ${reason}`
        : 'ACCOUNT UNFROZEN',
      note: `Action by Admin on ${new Date().toISOString()}`,
    });

    return {
      success: true,
      newStatus: profile.user.isActive ? 'Active' : 'Frozen',
    };
  }
}
