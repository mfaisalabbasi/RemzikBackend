import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
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
import { PartnerProfile } from 'src/partner/partner.entity';
import { PartnerStatus } from 'src/partner/enums/partner-status.enum';
import { Asset } from 'src/asset/asset.entity';
import { AssetStatus } from 'src/asset/enums/asset-status.enum';
import { AuditLog } from 'src/audit/audit.entity';
import { User } from 'src/user/user.entity';

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
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
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
      userId: mainUserId,
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

  async getPartnersList(): Promise<PartnerProfile[]> {
    return this.partnerRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async getPartnerDetail(id: string): Promise<any> {
    const partner = await this.partnerRepo.findOne({
      where: { id },
      relations: ['user', 'assets'],
    });

    if (!partner) throw new NotFoundException('Partner not found');

    const uniqueInvestors = await this.investmentRepo
      .createQueryBuilder('inv')
      .innerJoin('inv.asset', 'asset')
      .where('asset.partnerId = :partnerId', { partnerId: id })
      .andWhere('inv.status = :status', { status: InvestmentStatus.CONFIRMED })
      .select('COUNT(DISTINCT inv.investorId)', 'count')
      .getRawOne();

    return {
      ...partner,
      investorCount: parseInt(uniqueInvestors?.count || '0', 10),
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

  async approveKyc(investorProfileId: string, adminId: string) {
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

    // ✅ Audit Logging Integrated
    await this.auditService.log({
      adminId,
      action: AdminAction.KYC_APPROVED,
      targetId: investorProfileId,
      reason: 'Manual KYC Approval via Admin Panel',
    });

    return { success: true };
  }

  async toggleAccountFreeze(id: string, reason: string, adminId: string) {
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

    // ✅ Audit Logging Integrated
    await this.auditService.log({
      adminId,
      action: currentlyActive
        ? AdminAction.USER_SUSPENDED
        : AdminAction.APPROVE,
      targetId: id,
      reason:
        reason ||
        (currentlyActive ? 'Manual Suspension' : 'Manual Reactivation'),
    });

    return {
      success: true,
      newStatus: profile.user.isActive ? 'Active' : 'Frozen',
    };
  }

  async updatePartnerStatus(id: string, status: string, adminId: string) {
    const partner = await this.partnerRepo.findOne({ where: { id } });
    if (!partner) throw new NotFoundException('Partner not found');

    const formattedStatus = status.toUpperCase();
    const isValid = Object.values(PartnerStatus).includes(
      formattedStatus as any,
    );

    if (!isValid) {
      throw new BadRequestException(
        `Invalid status: ${status}. Expected one of: ${Object.values(PartnerStatus).join(', ')}`,
      );
    }

    partner.status = formattedStatus as any;
    const updatedPartner = await this.partnerRepo.save(partner);

    // ✅ Audit Logging Integrated
    await this.auditService.log({
      adminId,
      action:
        formattedStatus === PartnerStatus.APPROVED
          ? AdminAction.APPROVE
          : AdminAction.REJECT,
      targetId: id,
      reason: `Partner status manually updated to ${formattedStatus}`,
    });

    return updatedPartner;
  }

  async findAllAssets(): Promise<Asset[]> {
    try {
      return await this.assetRepo.find({
        relations: ['partner'],
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      console.error('Error fetching assets for directory:', error);
      throw new Error('Could not retrieve asset directory.');
    }
  }

  async findAssetDetail(id: string) {
    return await this.assetRepo.findOne({
      where: { id },
      relations: ['partner', 'token'],
    });
  }

  async updateAssetStatus(
    id: string,
    status: string,
    adminId: string,
    rejectionReason?: string,
  ): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id },
      relations: ['partner'],
    });

    if (!asset) {
      throw new NotFoundException(
        `Asset record ${id} not found in secure ledger.`,
      );
    }

    if (status === AssetStatus.PAID && asset.status !== AssetStatus.APPROVED) {
      throw new BadRequestException(
        'Asset must be APPROVED before it can be marked as PAID.',
      );
    }

    if (status === AssetStatus.REJECTED) {
      if (!rejectionReason) {
        throw new BadRequestException(
          'A rejection reason is mandatory for auditing purposes.',
        );
      }
      asset.rejectionReason = rejectionReason;
    } else {
      asset.rejectionReason = undefined;
    }

    if (status === AssetStatus.FREEZ) {
      console.log(`Asset ${id} has been frozen by Admin.`);
    }

    asset.status = status as AssetStatus;
    const updatedAsset = await this.assetRepo.save(asset);

    // ✅ Audit Logging Integrated
    let auditAction: AdminAction = AdminAction.APPROVE;
    if (status === AssetStatus.REJECTED) auditAction = AdminAction.REJECT;
    if (status === AssetStatus.FREEZ) auditAction = AdminAction.FREEZE;

    await this.auditService.log({
      adminId,
      targetId: id,
      action: auditAction,
      reason: rejectionReason || `Asset status changed to ${status}`,
    });

    return updatedAsset;
  }

  async getAssetActivity(assetId: string) {
    const investments = await this.investmentRepo.find({
      where: { asset: { id: assetId }, status: InvestmentStatus.CONFIRMED },
      relations: ['investor', 'investor.user'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return investments.map((inv) => ({
      type: 'BUY',
      participantId: inv.investor.id,
      participantName: inv.investor.user?.name,
      amount: inv.amount,
      timestamp: inv.createdAt,
    }));
  }

  async getAdminIdentity(userId: string) {
    console.log('--- ADMIN IDENTITY SYNC ---');
    console.log('Target User ID from Token:', userId);

    const user = await this.auditLogRepo.manager.findOne(User, {
      where: { id: userId },
    });

    if (!user) {
      console.error(`CRITICAL: No user found for ID ${userId}`);
      throw new NotFoundException('Admin record not found');
    }

    console.log('Found User in DB:', user.name, '| Role:', user.role);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      twoFactorEnabled: false,
    };
  }

  async getMyAdminActivity(adminId: string): Promise<AuditLog[]> {
    return await this.auditLogRepo.find({
      where: { adminId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
  }
}
