import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
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
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { ChainEventLog } from 'src/blockchain/chain-event-log.entity';
import { OracleService } from 'src/secondary-market/trade/oracle.service';
import { Mutex } from 'async-mutex';
import { RecoveryRequestEntity } from 'src/Recovery/recovery.entity';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

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
    private readonly blockchainService: BlockchainService,
    @InjectRepository(ChainEventLog)
    private readonly chainEventRepo: Repository<ChainEventLog>,
    private readonly oracleService: OracleService,
    @InjectRepository(RecoveryRequestEntity)
    private readonly recoveryRequestRepo: Repository<RecoveryRequestEntity>,
    private readonly notificationOrchestrator: NotificationOrchestrator,
  ) {}
  private readonly mutex = new Mutex();

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
   * Refined KYC Action
   */
  async handleKycAction(dto: AdminActionDto, adminId: string) {
    const kyc = await this.kycRepo.findOne({
      where: { id: dto.targetId },
      relations: ['user'],
    });

    if (!kyc) throw new NotFoundException('KYC record not found');

    await this.dataSource.transaction(async (manager) => {
      if (dto.action === AdminAction.APPROVE) {
        await this.kycService.approve(dto.targetId);
        if (kyc.user) {
          kyc.user.isVerified = true;
          await manager.save(User, kyc.user);

          if (kyc.user.walletAddress) {
            await this.blockchainService.registerIdentity(
              kyc.user.walletAddress,
              true,
            );
          }
        }
      } else if (dto.action === AdminAction.REJECT) {
        if (!dto.reason) throw new BadRequestException('Reason required');
        await this.kycService.reject(dto.targetId, dto.reason);
        if (kyc.user) {
          kyc.user.isVerified = false;
          await manager.save(User, kyc.user);

          if (kyc.user.walletAddress) {
            await this.blockchainService.registerIdentity(
              kyc.user.walletAddress,
              false,
            );
          }
        }
      }

      await this.auditService.log(
        {
          adminId,
          action: dto.action,
          targetId: dto.targetId,
          reason: dto.reason,
        },
        manager,
      );
    });

    // 🛡️ NOTIFICATION: Inform user of KYC status update
    if (kyc?.user?.id) {
      try {
        const isApproved = dto.action === AdminAction.APPROVE;
        await this.notificationOrchestrator.buildAndSave(
          kyc.user.id,
          isApproved ? 'kyc.approved' : 'kyc.rejected',
          {
            title: isApproved ? 'KYC Verified!' : 'KYC Verification Rejected',
            message: isApproved
              ? 'Your identity has been successfully verified.'
              : `Your verification was rejected. Reason: ${dto.reason || 'Not specified'}`,
            reason: dto.reason,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to send KYC status notification: ${err}`);
      }
    }
  }

  /**
   * Refactored: Approve KYC (Investor)
   */
  async approveKyc(investorProfileId: string, adminId: string) {
    const profile = await this.investorRepo.findOne({
      where: { id: investorProfileId },
      relations: ['user'],
    });
    if (!profile || !profile.user)
      throw new BadRequestException('Profile or User not found');

    if (profile.user.walletAddress) {
      await this.blockchainService.registerIdentity(
        profile.user.walletAddress,
        true,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      profile.user.isVerified = true;
      await manager.save(User, profile.user);
      await manager.update(
        KycProfile,
        { user: { id: profile.user.id } },
        { status: KycStatus.APPROVED },
      );

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

      await this.auditService.log(
        {
          adminId,
          action: AdminAction.KYC_APPROVED,
          targetId: investorProfileId,
          reason: 'Manual KYC Approval via Admin Panel',
        },
        manager,
      );

      return { success: true };
    });

    // 🛡️ NOTIFICATION: Inform user KYC verified
    try {
      await this.notificationOrchestrator.buildAndSave(
        profile.user.id,
        'kyc.approved',
        {
          title: 'KYC Verified!',
          message:
            'Your identity has been successfully verified by administration.',
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send KYC approval notification: ${err}`);
    }

    return result;
  }

  /**
   * Freeze/Unfreeze Account Safety Switch
   */
  async toggleAccountFreeze(id: string, reason: string, adminId: string) {
    const profile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!profile) throw new BadRequestException('Profile not found');

    const nextActiveState = !profile.user.isActive;

    if (profile.user.walletAddress) {
      await this.blockchainService.toggleFreeze(
        profile.user.walletAddress,
        !nextActiveState,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      profile.user.isActive = nextActiveState;
      await manager.save(User, profile.user);

      await this.ledgerService.record(
        {
          userId: profile.user.id,
          amount: 0,
          type: LedgerType.ADJUSTMENT,
          source: LedgerSource.ADMIN_ADJUSTMENT,
          description: nextActiveState
            ? 'ACCOUNT UNFROZEN'
            : `ACCOUNT FROZEN: ${reason}`,
        },
        manager,
      );

      await this.auditService.log(
        {
          adminId,
          action: nextActiveState
            ? AdminAction.APPROVE
            : AdminAction.USER_SUSPENDED,
          targetId: id,
          reason:
            reason ||
            (nextActiveState ? 'Manual Reactivation' : 'Manual Suspension'),
        },
        manager,
      );

      return {
        success: true,
        newStatus: profile.user.isActive ? 'Active' : 'Frozen',
      };
    });

    // 🛡️ NOTIFICATION: Inform user account freeze state changed
    try {
      await this.notificationOrchestrator.buildAndSave(
        profile.user.id,
        nextActiveState ? 'user.unfrozen' : 'user.frozen',
        {
          title: nextActiveState ? 'Account Reactivated' : 'Account Suspended',
          message: nextActiveState
            ? 'Your account has been reactivated by administration.'
            : `Your account has been suspended. Reason: ${reason || 'Security compliance'}`,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send account status notification: ${err}`);
    }

    return result;
  }

  /**
   * Reject Investor Profile KYC
   */
  async rejectKyc(investorProfileId: string, reason: string, adminId: string) {
    const profile = await this.investorRepo.findOne({
      where: { id: investorProfileId },
      relations: ['user'],
    });
    if (!profile || !profile.user)
      throw new BadRequestException('Profile or User not found');

    if (profile.user.walletAddress) {
      await this.blockchainService.registerIdentity(
        profile.user.walletAddress,
        false,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      profile.user.isVerified = false;
      await manager.save(User, profile.user);
      await manager.update(
        KycProfile,
        { user: { id: profile.user.id } },
        { status: KycStatus.REJECTED, rejectionReason: reason },
      );

      await this.auditService.log(
        {
          adminId,
          action: AdminAction.REJECT,
          targetId: investorProfileId,
          reason: `KYC Rejected: ${reason}`,
        },
        manager,
      );

      return { success: true };
    });

    // 🛡️ NOTIFICATION: Inform user KYC rejected
    try {
      await this.notificationOrchestrator.buildAndSave(
        profile.user.id,
        'kyc.rejected',
        {
          title: 'KYC Verification Rejected',
          message: `Your verification was rejected. Reason: ${reason}`,
          reason,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send KYC rejection notification: ${err}`);
    }

    return result;
  }

  async handlePartnerAction(dto: AdminActionDto, adminId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { id: dto.targetId },
      relations: ['user'],
    });

    await this.dataSource.transaction(async (manager) => {
      if (dto.action === AdminAction.APPROVE)
        await this.partnerService.approve(dto.targetId);
      if (dto.action === AdminAction.REJECT) {
        if (!dto.reason)
          throw new BadRequestException('Rejection reason is required');
        await this.partnerService.reject(dto.targetId, dto.reason);
      }

      await this.auditService.log(
        {
          adminId,
          action: dto.action,
          targetId: dto.targetId,
          reason: dto.reason,
        },
        manager,
      );
    });

    // 🛡️ NOTIFICATION: Inform partner of action result
    if (partner?.user?.id) {
      try {
        const isApproved = dto.action === AdminAction.APPROVE;
        await this.notificationOrchestrator.buildAndSave(
          partner.user.id,
          isApproved ? 'partner.approved' : 'partner.rejected',
          {
            title: isApproved
              ? 'Partner Account Approved!'
              : 'Partner Application Rejected',
            message: isApproved
              ? 'Your company profile has been approved.'
              : `Your application was rejected. Reason: ${dto.reason || 'Not specified'}`,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to send partner action notification: ${err}`);
      }
    }
  }

  async handleAssetAction(dto: AdminActionDto, adminId: string) {
    const asset = await this.assetRepo.findOne({
      where: { id: dto.targetId },
      relations: ['partner', 'partner.user'],
    });

    await this.dataSource.transaction(async (manager) => {
      if (dto.action === AdminAction.APPROVE)
        await this.assetService.approve(dto.targetId);
      if (dto.action === AdminAction.FREEZE)
        await this.assetService.freeze(dto.targetId);

      await this.auditService.log(
        {
          adminId,
          action: dto.action,
          targetId: dto.targetId,
          reason: dto.reason,
        },
        manager,
      );
    });

    // 🛡️ NOTIFICATION: Inform partner of asset action
    if (asset?.partner?.user?.id) {
      try {
        const isApproved = dto.action === AdminAction.APPROVE;
        await this.notificationOrchestrator.buildAndSave(
          asset.partner.user.id,
          isApproved ? 'asset.approved' : 'asset.frozen',
          {
            title: isApproved ? 'Asset Approved!' : 'Asset Frozen',
            message: isApproved
              ? `Your asset listing "${asset.title}" has been approved.`
              : `Your asset listing "${asset.title}" has been frozen by administration.`,
            assetId: asset.id,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to send asset action notification: ${err}`);
      }
    }
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
    let investorProfile = await this.investorRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!investorProfile) {
      investorProfile = await this.investorRepo.findOne({
        where: { user: { id } },
        relations: ['user'],
      });
    }

    if (!investorProfile || !investorProfile.user)
      throw new BadRequestException(
        'Investor profile or linked user not found',
      );

    const mainUserId = investorProfile.user.id;

    const [wallet, history, kyc, recoveryRequests] = await Promise.all([
      this.walletRepo.findOne({ where: { userId: mainUserId } }),
      this.ledgerService.findByUser(mainUserId),
      this.kycRepo.findOne({
        where: { user: { id: mainUserId } },
        order: { createdAt: 'DESC' },
      }),
      this.recoveryRequestRepo.find({
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
      recoveryRequests: recoveryRequests || [],
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
    const partner = await this.partnerRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!partner || !partner.user)
      throw new NotFoundException('Partner or User not found');

    const formattedStatus = status.toUpperCase();

    if (
      formattedStatus === PartnerStatus.APPROVED &&
      partner.user.walletAddress
    ) {
      await this.blockchainService.registerIdentity(
        partner.user.walletAddress,
        true,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      partner.status = formattedStatus as PartnerStatus;
      await manager.save(PartnerProfile, partner);

      await this.auditService.log(
        {
          adminId,
          action:
            formattedStatus === PartnerStatus.APPROVED
              ? AdminAction.APPROVE
              : AdminAction.REJECT,
          targetId: id,
          reason: `Partner status manually updated to ${formattedStatus}`,
        },
        manager,
      );

      return partner;
    });

    // 🛡️ NOTIFICATION: Inform partner of status change
    try {
      const isApproved = formattedStatus === PartnerStatus.APPROVED;
      await this.notificationOrchestrator.buildAndSave(
        partner.user.id,
        isApproved ? 'partner.approved' : 'partner.rejected',
        {
          title: isApproved
            ? 'Partner Account Approved!'
            : 'Partner Status Updated',
          message: `Your company status has been updated to ${formattedStatus}.`,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send partner status notification: ${err}`);
    }

    return result;
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
      relations: ['partner', 'partner.user'],
    });

    if (!asset) throw new NotFoundException(`Asset record ${id} not found.`);

    if (status === AssetStatus.REJECTED) {
      if (!rejectionReason)
        throw new BadRequestException('Rejection reason mandatory.');
      asset.rejectionReason = rejectionReason;
    }

    let auditAction: AdminAction = AdminAction.APPROVE;
    if (status === AssetStatus.REJECTED) auditAction = AdminAction.REJECT;
    if (status === AssetStatus.FREEZ) auditAction = AdminAction.FREEZE;

    const updatedAsset = await this.dataSource.transaction(async (manager) => {
      asset.status = status as AssetStatus;
      const updated = await manager.save(Asset, asset);

      await this.auditService.log(
        {
          adminId,
          targetId: id,
          action: auditAction,
          reason: rejectionReason || `Asset status changed to ${status}`,
        },
        manager,
      );

      return updated;
    });

    // 🛡️ NOTIFICATION: Inform partner of asset status update
    if (asset?.partner?.user?.id) {
      try {
        const isApproved = status === AssetStatus.APPROVED;
        const isRejected = status === AssetStatus.REJECTED;
        await this.notificationOrchestrator.buildAndSave(
          asset.partner.user.id,
          isApproved
            ? 'asset.approved'
            : isRejected
              ? 'asset.rejected'
              : 'asset.status_updated',
          {
            title: isApproved
              ? 'Asset Approved!'
              : isRejected
                ? 'Asset Listing Rejected'
                : 'Asset Status Updated',
            message: isApproved
              ? `Your asset "${asset.title}" has been approved.`
              : isRejected
                ? `Your asset "${asset.title}" was rejected. Reason: ${rejectionReason}`
                : `Your asset status changed to ${status}.`,
            reason: rejectionReason,
            assetId: asset.id,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to send asset status notification: ${err}`);
      }
    }

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

    const nextActiveState = !partner.user.isActive;

    if (partner.user.walletAddress) {
      await this.blockchainService.toggleFreeze(
        partner.user.walletAddress,
        !nextActiveState,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      partner.user.isActive = nextActiveState;
      await manager.save(User, partner.user);

      await this.auditService.log(
        {
          adminId,
          action: nextActiveState
            ? AdminAction.APPROVE
            : AdminAction.USER_SUSPENDED,
          targetId: partnerId,
          reason:
            reason ||
            (nextActiveState ? 'Manual Reactivation' : 'Manual Suspension'),
        },
        manager,
      );

      return { success: true, isActive: partner.user.isActive };
    });

    // 🛡️ NOTIFICATION: Inform partner freeze state updated
    try {
      await this.notificationOrchestrator.buildAndSave(
        partner.user.id,
        nextActiveState ? 'partner.unfrozen' : 'partner.frozen',
        {
          title: nextActiveState
            ? 'Partner Account Reactivated'
            : 'Partner Account Suspended',
          message: nextActiveState
            ? 'Your partner account has been reactivated.'
            : `Your partner account has been suspended. Reason: ${reason || 'Compliance'}`,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send partner freeze notification: ${err}`);
    }

    return result;
  }

  async getExplorerData(query: string | undefined, page: number = 1) {
    const limit = 20;

    if (query && query.trim() !== '') {
      const events = await this.chainEventRepo
        .createQueryBuilder('log')
        .where('log.txHash ILIKE :query', { query: `%${query}%` })
        .orWhere('log.eventName ILIKE :query', { query: `%${query}%` })
        .getMany();

      const audits = await this.auditLogRepo
        .createQueryBuilder('audit')
        .where('audit.targetId = :query', { query })
        .getMany();

      return [...events, ...audits].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    }

    return await this.chainEventRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getAddressState(targetId: string) {
    const latestEvent = await this.chainEventRepo
      .createQueryBuilder('log')
      .where("log.eventData->>'targetId' = :targetId", { targetId })
      .orderBy('log.createdAt', 'DESC')
      .getOne();

    return {
      targetId,
      isVerified: latestEvent?.eventData?.status === true,
      lastEvent: latestEvent?.eventName,
      lastUpdated: latestEvent?.createdAt,
    };
  }

  async getTransactionDetail(txHash: string) {
    const event = await this.chainEventRepo.findOne({ where: { txHash } });
    const audit = await this.auditLogRepo.findOne({ where: { txHash } });

    if (!event) throw new NotFoundException('Transaction not found on chain');

    return {
      event,
      audit,
      block: event.blockNumber,
      timestamp: event.createdAt,
    };
  }

  /**
   * 🛡️ Upgraded Asset Price Update with mandatory admin audit recording
   */
  async updateAssetPrice(id: string, newPrice: number, adminId: string) {
    return await this.mutex.runExclusive(async () => {
      const asset = await this.assetRepo.findOne({
        where: { id },
        relations: ['partner', 'partner.user'],
      });
      if (!asset) throw new NotFoundException(`Asset record ${id} not found.`);

      const oldPrice = asset.unitPrice;

      const updatedAsset = await this.dataSource.transaction(
        async (manager) => {
          await manager.update(Asset, id, { unitPrice: newPrice });
          await this.oracleService.syncAssetPriceToOracle(id);

          await this.auditService.log(
            {
              adminId,
              targetId: id,
              action: AdminAction.APPROVE,
              reason: `Asset valuation adjusted from SAR ${oldPrice} to SAR ${newPrice}`,
            },
            manager,
          );

          return await manager.findOne(Asset, { where: { id } });
        },
      );

      // 🛡️ NOTIFICATION: Inform partner of asset price update
      if (asset?.partner?.user?.id) {
        try {
          await this.notificationOrchestrator.buildAndSave(
            asset.partner.user.id,
            'asset.price_updated',
            {
              title: 'Asset Valuation Updated',
              message: `The unit price for "${asset.title}" has been updated from SAR ${oldPrice} to SAR ${newPrice}.`,
              assetId: asset.id,
              oldPrice,
              newPrice,
              timestamp: new Date(),
            },
          );
        } catch (err) {
          this.logger.error(
            `Failed to send asset price update notification: ${err}`,
          );
        }
      }

      return updatedAsset;
    });
  }
}
