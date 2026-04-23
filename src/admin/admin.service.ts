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
import { LedgerService } from 'src/ledger/ledger.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';
import { KycProfile } from 'src/kyc/kyc.entity';
import { KycStatus } from 'src/kyc/enums/kyc-status.enum';

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
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,
  ) {}

  async getUrgentQueue(): Promise<UrgentTask[]> {
    const [pendingKyc, pendingPartners, pendingAssets] = await Promise.all([
      this.kycService.findAllPending(),
      this.partnerService.findAllPending(),
      this.assetService.findAllPending(),
    ]);
    const queue: UrgentTask[] = [];
    pendingKyc.forEach((item: any) => {
      queue.push({
        id: item.id,
        type: 'KYC',
        title: `KYC Review: ${item.user?.fullName || 'New User'}`,
        priority: 'HIGH',
        createdAt: item.createdAt,
      });
    });
    pendingPartners.forEach((item: any) => {
      queue.push({
        id: item.id,
        type: 'PARTNER',
        title: `Partner Onboarding: ${item.companyName || 'Corporate Entity'}`,
        priority: 'MEDIUM',
        createdAt: item.createdAt,
      });
    });
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
    if (dto.action === AdminAction.APPROVE)
      await this.partnerService.approve(dto.targetId);
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
    if (dto.action === AdminAction.APPROVE)
      await this.assetService.approve(dto.targetId);
    if (dto.action === AdminAction.FREEZE)
      await this.assetService.freeze(dto.targetId);
    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  async handleKycAction(dto: AdminActionDto, adminId: string) {
    if (dto.action === AdminAction.APPROVE)
      await this.kycService.approve(dto.targetId);
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

  async getDashboardPipeline() {
    return await this.assetService.getPipelineStats();
  }

  async getComplianceStatus(): Promise<ComplianceStatus> {
    const lastAudit = await this.auditService.findLatest();
    return {
      regulatoryHealth: 'OPTIMAL',
      lastAuditDate: lastAudit ? lastAudit.createdAt : null,
      issuesCount: 0,
    };
  }

  async getLiquidityStats(): Promise<LiquidityStats> {
    return {
      systemOperational: 1250000.5,
      poolLiquidity: 8450000.0,
      reserveFund: 25000000.0,
      healthScore: 94,
    };
  }

  async getInvestorsList() {
    const profiles = await this.investorRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    return Promise.all(
      profiles.map(async (profile) => {
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
    const investorProfile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!investorProfile || !investorProfile.user)
      throw new BadRequestException(
        'Investor profile or linked user not found',
      );
    const mainUserId = investorProfile.user.id;

    const [wallet, history, kyc] = await Promise.all([
      this.walletRepo.findOne({ where: { userId: mainUserId } }),
      this.ledgerService.findByUser(mainUserId),
      this.kycRepo.findOne({
        where: { userId: mainUserId },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const ledger = history.map((entry) => {
      const isOutflow =
        [
          LedgerType.DEBIT,
          LedgerType.WITHDRAWAL_REQUEST,
          LedgerType.WITHDRAWAL_PAID,
        ].includes(entry.type as any) ||
        [
          LedgerSource.ASSET_INVESTMENT,
          LedgerSource.SECONDARY_MARKET_BUY,
          LedgerSource.ESCROW_LOCK,
        ].includes(entry.source as any);
      return {
        id: entry.id,
        date: entry.createdAt,
        action:
          entry.description || entry.note || entry.source.replace(/_/g, ' '),
        amount: isOutflow
          ? -Math.abs(Number(entry.amount))
          : Math.abs(Number(entry.amount)),
        type: this.mapSourceToMarketType(entry.source),
      };
    });

    return {
      id: investorProfile.id,
      userId: mainUserId, // Crucial for Direct Messaging
      name: investorProfile.user.name,
      email: investorProfile.user.email,
      isActive: investorProfile.user.isActive,
      status: kyc?.status || 'NOT_SUBMITTED',
      availableBalance: Number(wallet?.availableBalance || 0),
      lockedBalance: Number(wallet?.lockedBalance || 0),
      totalEarned: Number(wallet?.totalEarned || 0),
      kycExpiry: '2027-05-12',
      documents: [
        {
          name: 'National ID / Passport',
          status: kyc?.status || 'PENDING',
          s3Key: kyc?.idDocumentUrl || null,
        },
        {
          name: 'Proof of Address',
          status: kyc?.status || 'PENDING',
          s3Key: kyc?.addressProofUrl || null,
        },
      ],
      ledger,
    };
  }

  private mapSourceToMarketType(
    source: LedgerSource,
  ): 'PRIMARY' | 'SECONDARY' | 'CASH' {
    const s = source.toString();
    if (s.includes('INVESTMENT') || s.includes('ASSET')) return 'PRIMARY';
    if (s.includes('SECONDARY')) return 'SECONDARY';
    return 'CASH';
  }

  async approveKyc(investorProfileId: string) {
    const profile = await this.investorRepo.findOne({
      where: { id: investorProfileId },
      relations: ['user'],
    });
    if (!profile) throw new BadRequestException('Profile not found');
    profile.user.isVerified = true;
    await this.investorRepo.manager.save(profile.user);
    await this.kycRepo.update(
      { userId: profile.user.id },
      { status: KycStatus.APPROVED },
    );
    await this.ledgerService.record({
      userId: profile.user.id,
      amount: 0,
      type: LedgerType.ADJUSTMENT,
      source: LedgerSource.ADMIN_ADJUSTMENT,
      description: 'KYC Approved by Admin',
    });
    return { success: true };
  }

  async toggleAccountFreeze(id: string, reason: string) {
    const profile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!profile) throw new BadRequestException('Profile not found');
    const currentlyActive = profile.user.isActive;
    profile.user.isActive = !currentlyActive;
    await this.investorRepo.manager.save(profile.user);
    await this.ledgerService.record({
      userId: profile.user.id,
      amount: 0,
      type: LedgerType.ADJUSTMENT,
      source: LedgerSource.ADMIN_ADJUSTMENT,
      description: currentlyActive
        ? `ACCOUNT FROZEN: ${reason}`
        : 'ACCOUNT UNFROZEN',
    });
    return {
      success: true,
      newStatus: profile.user.isActive ? 'Active' : 'Frozen',
    };
  }
}
