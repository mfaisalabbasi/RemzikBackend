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
import { DataSource, Repository, EntityManager } from 'typeorm';
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
    private readonly dataSource: DataSource,
  ) {}

  // ... (getUrgentQueue remains unchanged) ...
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

  /**
   * Refined KYC Action:
   * Rejection keeps the account ACTIVE so the user can re-upload.
   */
  async handleKycAction(dto: AdminActionDto, adminId: string) {
    const kyc = await this.kycRepo.findOne({
      where: { id: dto.targetId },
      relations: ['user'],
    });

    if (!kyc) throw new NotFoundException('KYC record not found');

    if (dto.action === AdminAction.APPROVE) {
      await this.kycService.approve(dto.targetId);
      // FLIP THE SWITCH
      if (kyc.user) {
        kyc.user.isVerified = true;
        await this.dataSource.manager.save(User, kyc.user);
      }
    } else if (dto.action === AdminAction.REJECT) {
      if (!dto.reason) throw new BadRequestException('Reason required');
      await this.kycService.reject(dto.targetId, dto.reason);
      // FLIP THE SWITCH
      if (kyc.user) {
        kyc.user.isVerified = false;
        await this.dataSource.manager.save(User, kyc.user);
      }
    }

    await this.auditService.log({
      adminId,
      action: dto.action,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  /**
   * Directly approves an investor profile and flips isVerified.
   */
  async approveKyc(investorProfileId: string, adminId: string) {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const profile = await manager.findOne(InvestorProfile, {
        where: { id: investorProfileId },
        relations: ['user'],
      });

      if (!profile || !profile.user)
        throw new BadRequestException('Profile or User not found');

      // 1. Update User verification status
      profile.user.isVerified = true;
      await manager.save(User, profile.user);

      // 2. Update KYC status via relationship
      await manager.update(
        KycProfile,
        { user: { id: profile.user.id } }, // Targeting the User relation
        { status: KycStatus.APPROVED },
      );

      // 3. Ledger Record
      await this.ledgerService.record(
        {
          userId: profile.user.id,
          amount: 0,
          type: LedgerType.ADJUSTMENT,
          source: LedgerSource.ADMIN_ADJUSTMENT,
          description: 'KYC Approved by Admin',
        },
        manager,
      );

      // 4. Audit Log
      await this.auditService.log({
        adminId,
        action: AdminAction.KYC_APPROVED,
        targetId: investorProfileId,
        reason: 'Manual KYC Approval via Admin Panel',
      });

      return { success: true };
    });
  }

  /**
   * Freeze/Unfreeze: The ultimate safety switch.
   */
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

  async rejectKyc(investorProfileId: string, reason: string, adminId: string) {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const profile = await manager.findOne(InvestorProfile, {
        where: { id: investorProfileId },
        relations: ['user'],
      });

      if (!profile || !profile.user)
        throw new BadRequestException('Profile or User not found');

      // 1. Ensure isVerified is false
      profile.user.isVerified = false;
      await manager.save(User, profile.user);

      // 2. Update KYC status and store the rejection reason
      // This allows the user to see WHY they were rejected on their dashboard
      await manager.update(
        KycProfile,
        { user: { id: profile.user.id } },
        {
          status: KycStatus.REJECTED,
          rejectionReason: reason, // Make sure this column exists in your KycProfile entity
        },
      );

      // 3. Audit Logging
      await this.auditService.log({
        adminId,
        action: AdminAction.REJECT, // Use your REJECT enum
        targetId: investorProfileId,
        reason: `KYC Rejected: ${reason}`,
      });

      return { success: true };
    });
  }

  // ... (getInvestorDetail, handlePartnerAction, etc. merged below) ...

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
        where: { user: { id: mainUserId } }, // Corrected relation lookup
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
      relations: ['user', 'user.kyc', 'assets'],
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

  async updatePartnerStatus(id: string, status: string, adminId: string) {
    const partner = await this.partnerRepo.findOne({ where: { id } });
    if (!partner) throw new NotFoundException('Partner not found');

    const formattedStatus = status.toUpperCase();
    const isValid = Object.values(PartnerStatus).includes(
      formattedStatus as any,
    );

    if (!isValid) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    partner.status = formattedStatus as any;
    const updatedPartner = await this.partnerRepo.save(partner);

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
    return await this.assetRepo.find({
      relations: ['partner'],
      order: { createdAt: 'DESC' },
    });
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

    if (!asset) throw new NotFoundException(`Asset record ${id} not found.`);

    if (status === AssetStatus.REJECTED) {
      if (!rejectionReason)
        throw new BadRequestException('Rejection reason mandatory.');
      asset.rejectionReason = rejectionReason;
    }

    asset.status = status as AssetStatus;
    const updatedAsset = await this.assetRepo.save(asset);

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
    const user = await this.dataSource.manager.findOne(User, {
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('Admin record not found');
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

  async getAssetDistributions(assetId: string) {
    return await this.dataSource.query(
      `SELECT "batchId", "period", "status", SUM(amount) as "totalAmount", MIN("createdAt") as "date"
       FROM distributions WHERE "assetId" = $1 GROUP BY "batchId", "period", "status" ORDER BY "date" DESC`,
      [assetId],
    );
  }

  async togglePartnerFreeze(
    partnerId: string,
    reason: string,
    adminId: string,
  ) {
    const partner = await this.partnerRepo.findOne({
      where: { id: partnerId },
      relations: ['user'],
    });

    if (!partner || !partner.user)
      throw new NotFoundException('Partner User not found');

    const currentlyActive = partner.user.isActive;
    partner.user.isActive = !currentlyActive;

    await this.dataSource.manager.save(User, partner.user);

    // Log to Audit and Ledger
    await this.auditService.log({
      adminId,
      action: currentlyActive
        ? AdminAction.USER_SUSPENDED
        : AdminAction.APPROVE,
      targetId: partnerId,
      reason:
        reason ||
        (currentlyActive ? 'Manual Suspension' : 'Manual Reactivation'),
    });

    return {
      success: true,
      isActive: partner.user.isActive,
    };
  }
}
