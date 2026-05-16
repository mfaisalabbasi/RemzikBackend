import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Asset } from './asset.entity';
import { CreateAssetDto } from './dto/create-asset.dto';
import { PartnerProfile } from 'src/partner/partner.entity';
import { AssetStatus } from './enums/asset-status.enum';
import { StorageService } from '../storage/storage.service';
import { Investment } from 'src/investment/investment.entity';
import { InvestmentStatus } from 'src/investment/enums/investment-status.enum';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';

@Injectable()
export class AssetService {
  private logger = new Logger(AssetService.name);

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly storageService: StorageService,
    private readonly notificationOrchestrator: NotificationOrchestrator,
  ) {}

  // --- PRIVATE UTILITIES ---

  private isValidUuid(id: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  private async uploadFiles(
    fileList: Express.Multer.File[] | undefined,
    folder: string,
  ): Promise<string[]> {
    const urls: string[] = [];
    if (!fileList?.length) return urls;
    for (const file of fileList) {
      const url = await this.storageService.uploadFile(file, folder);
      urls.push(url);
    }
    return urls;
  }

  private mapAssetStatusToDoc(status: AssetStatus): string {
    switch (status) {
      case AssetStatus.APPROVED:
        return 'Approved';
      case AssetStatus.SUBMITTED:
        return 'Submitted';
      case AssetStatus.REJECTED:
        return 'Rejected';
      default:
        return 'Pending';
    }
  }

  // --- CORE MUTATIONS ---

  /**
   * ✅ FIXED: Flexible math allows any investment amount/entry.
   */
  async createAsset(
    userId: string,
    dto: CreateAssetDto,
    files: any,
  ): Promise<Asset> {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    // 🛡️ SECURITY FIREWALL
    if (!partner) throw new BadRequestException('Partner profile required');
    if (partner.user?.isActive === false || partner.status === 'FROZEN') {
      throw new BadRequestException(
        'Action blocked: Your account or partner profile is currently inactive or frozen.',
      );
    }

    // 🛡️ REVERTED TO STRICT TOKEN MATH
    const totalValue = Number(dto.totalValue);
    const tokenSupply = Number(dto.tokenSupply || 0);

    if (tokenSupply <= 0) {
      throw new BadRequestException('Token supply must be greater than 0');
    }

    // Calculate unit price and round to 2 decimals for clean currency display
    const rawUnitPrice = totalValue / tokenSupply;
    const unitPrice = Math.round(rawUnitPrice * 100) / 100;

    // Integrity check: ensures (Unit Price * Supply) equals Total Value
    const calculatedTotal = unitPrice * tokenSupply;
    const difference = Math.abs(totalValue - calculatedTotal);

    if (difference > 0.05) {
      throw new BadRequestException(
        `Math Mismatch: Unit price ${unitPrice} * supply ${tokenSupply} = ${calculatedTotal}. ` +
          `Difference from Total Value (${totalValue}) exceeds 0.05. Please adjust token supply.`,
      );
    }

    let uploadedUrls: string[] = [];
    try {
      const [
        galleryImages,
        legalDocuments,
        financialDocuments,
        otherDocuments,
      ] = await Promise.all([
        this.uploadFiles(files.galleryImages, 'assets/gallery'),
        this.uploadFiles(files.legalDocuments, 'assets/legal'),
        this.uploadFiles(files.financialDocuments, 'assets/financial'),
        this.uploadFiles(files.otherDocuments, 'assets/other'),
      ]);

      uploadedUrls = [
        ...galleryImages,
        ...legalDocuments,
        ...financialDocuments,
        ...otherDocuments,
      ];

      const asset = this.assetRepo.create({
        ...dto,
        totalValue,
        unitPrice, // Using the rounded unit price
        tokenSupply,
        partner,
        galleryImages,
        legalDocuments,
        financialDocuments,
        otherDocuments,
        status: AssetStatus.SUBMITTED,
      });

      const savedAsset = await this.assetRepo.save(asset);
      this.logger.log(
        `Asset ${savedAsset.id} created successfully by Partner ${partner.id}`,
      );
      return savedAsset;
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown database error';
      this.logger.error(
        `Asset creation failed: ${errorMessage}. Files uploaded: ${uploadedUrls.length}`,
      );
      throw new BadRequestException(
        'Asset creation failed. Please check your data and try again.',
      );
    }
  }

  // --- PARTNER DASHBOARD & ANALYTICS ---

  async getPartnerInvestors(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];

    const investments = await this.investmentRepo.find({
      where: { asset: { partner: { id: partner.id } } },
      relations: ['investor', 'investor.user', 'asset'],
      order: { createdAt: 'DESC' },
    });

    return investments.map((inv) => {
      const amount = Number(inv.amount);
      const totalValue = Number(inv.asset.totalValue);
      const ownershipPercent =
        totalValue > 0 ? ((amount / totalValue) * 100).toFixed(2) : '0';

      let lifecycleStatus = 'Joined';
      if (inv.status === InvestmentStatus.CONFIRMED) lifecycleStatus = 'Funded';
      if (
        inv.asset.status === AssetStatus.FREEZ ||
        inv.asset.status === AssetStatus.PAID
      ) {
        lifecycleStatus = 'Active';
      }

      return {
        id: inv.id,
        name: inv.investor?.user?.name || 'Investor',
        asset: inv.asset.title,
        invested: amount,
        ownership: `${ownershipPercent}%`,
        status: lifecycleStatus,
      };
    });
  }

  async getPartnerWithdrawals(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];

    const requests = await this.investmentRepo.find({
      where: {
        asset: { partner: { id: partner.id } },
        status: InvestmentStatus.PENDING,
      },
      relations: ['asset', 'investor', 'investor.user'],
    });

    return requests.map((req) => ({
      id: req.id,
      asset: req.asset.title,
      amount: Number(req.amount),
      status: 'Pending',
      investorName: req.investor?.user?.name || 'Investor',
    }));
  }

  async getAssetsByPartner(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      assets.map(async (a) => {
        const stats = await this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(CAST(inv.amount AS NUMERIC))', 'raised')
          .addSelect('COUNT(DISTINCT inv.investorId)', 'investors')
          .where('inv.assetId = :id', { id: a.id })
          .andWhere('inv.status != :pending', {
            pending: InvestmentStatus.PENDING,
          })
          .getRawOne();

        const raisedAmount = parseFloat(stats?.raised || '0');
        const targetAmount = Number(a.totalValue) || 0;

        let stage = 'Approved';
        if (a.status === AssetStatus.SUBMITTED) stage = 'Compliance';
        else if (a.status === AssetStatus.REJECTED) stage = 'Rejected';
        else if (
          raisedAmount >= targetAmount ||
          a.status === AssetStatus.FREEZ ||
          a.status === AssetStatus.PAID
        ) {
          stage = 'Completed';
        } else if (a.status === AssetStatus.APPROVED) {
          stage = 'Funding';
        }

        return {
          id: a.id,
          name: a.title,
          type: a.type || 'Real Estate',
          stage: stage,
          target: targetAmount,
          raised: raisedAmount,
          roi: Number(a.expectedYield || 0),
          investors: parseInt(stats?.investors || '0'),
        };
      }),
    );
  }

  async getRecentActivity(userId: string) {
    try {
      const partner = await this.partnerRepo.findOne({
        where: { user: { id: userId } },
      });
      if (!partner) return [];
      const assets = await this.assetRepo.find({
        where: { partner: { id: partner.id } },
      });
      if (assets.length === 0) return [];

      const assetIds = assets.map((a) => a.id);
      const activities = await this.investmentRepo
        .createQueryBuilder('inv')
        .innerJoin('inv.asset', 'asset')
        .innerJoin('inv.investor', 'investor')
        .innerJoin('investor.user', 'user')
        .select([
          'user.name AS "investorName"',
          'asset.title AS "assetName"',
          'inv.amount AS "amount"',
          'inv.createdAt AS "date"',
        ])
        .where('inv.assetId IN (:...assetIds)', { assetIds })
        .orderBy('inv.createdAt', 'DESC')
        .limit(7)
        .getRawMany();

      return activities.map((act) => ({
        investorName: act.investorName || 'Investor',
        assetName: act.assetName || 'Asset',
        amount: Number(act.amount) || 0,
        date: act.date
          ? new Date(act.date).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
            })
          : 'Recent',
      }));
    } catch (error: any) {
      this.logger.error(`Activity Error: ${error.message}`);
      return [];
    }
  }

  async getPartnerKPI(userId: string) {
    try {
      const partner = await this.partnerRepo.findOne({
        where: { user: { id: userId } },
      });
      if (!partner) throw new BadRequestException('Partner profile required');
      const assets = await this.assetRepo.find({
        where: { partner: { id: partner.id } },
      });
      if (assets.length === 0)
        return {
          totalAssets: 0,
          activeFunding: 0,
          fullyFunded: 0,
          pendingCompliance: 0,
          totalRaised: 0,
          avgROI: 0,
        };

      const assetIds = assets.map((a) => a.id);
      const totalRaisedRes = await this.investmentRepo
        .createQueryBuilder('inv')
        .select('SUM(CAST(inv.amount AS NUMERIC))', 'sum')
        .where('inv.assetId IN (:...assetIds)', { assetIds })
        .andWhere('inv.status != :pending', {
          pending: InvestmentStatus.PENDING,
        })
        .getRawOne();

      const assetStats = await Promise.all(
        assets.map(async (a) => {
          const res = await this.investmentRepo
            .createQueryBuilder('inv')
            .select('SUM(CAST(inv.amount AS NUMERIC))', 'sum')
            .where('inv.assetId = :id', { id: a.id })
            .andWhere('inv.status != :pending', {
              pending: InvestmentStatus.PENDING,
            })
            .getRawOne();
          const raised = parseFloat(res?.sum || '0');
          const target = Number(a.totalValue);
          return {
            isFullyFunded:
              a.status === AssetStatus.FREEZ ||
              a.status === AssetStatus.PAID ||
              raised >= target,
            isActive: a.status === AssetStatus.APPROVED && raised < target,
          };
        }),
      );

      return {
        totalAssets: assets.length,
        activeFunding: assetStats.filter((s) => s.isActive).length,
        fullyFunded: assetStats.filter((s) => s.isFullyFunded).length,
        pendingCompliance: assets.filter(
          (a) => a.status === AssetStatus.SUBMITTED,
        ).length,
        totalRaised: parseFloat(totalRaisedRes?.sum || '0'),
        avgROI: Number(
          (
            assets.reduce((s, a) => s + Number(a.expectedYield || 0), 0) /
            assets.length
          ).toFixed(1),
        ),
      };
    } catch (error: any) {
      this.logger.error(`KPI Error: ${error.message}`);
      return {
        totalAssets: 0,
        activeFunding: 0,
        fullyFunded: 0,
        pendingCompliance: 0,
        totalRaised: 0,
        avgROI: 0,
      };
    }
  }

  async getPartnerPerformance(userId: string) {
    try {
      const partner = await this.partnerRepo.findOne({
        where: { user: { id: userId } },
      });
      if (!partner) throw new BadRequestException('Partner profile not found');
      const assets = await this.assetRepo.find({
        where: { partner: { id: partner.id } },
      });
      if (assets.length === 0)
        return { totalFunding: 0, investors: 0, avgROI: '0.0', listings: 0 };

      const assetIds = assets.map((a) => a.id);
      const stats = await this.investmentRepo
        .createQueryBuilder('inv')
        .select('SUM(CAST(inv.amount AS NUMERIC))', 'total')
        .addSelect('COUNT(DISTINCT inv.investorId)', 'investors')
        .where('inv.assetId IN (:...assetIds)', { assetIds })
        .andWhere('inv.status != :pending', {
          pending: InvestmentStatus.PENDING,
        })
        .getRawOne();

      return {
        totalFunding: Math.floor(parseFloat(stats?.total || '0')),
        investors: parseInt(stats?.investors || '0'),
        avgROI: (
          assets.reduce((sum, a) => sum + Number(a.expectedYield || 0), 0) /
          assets.length
        ).toFixed(1),
        listings: assets.length,
      };
    } catch (error: any) {
      return { totalFunding: 0, investors: 0, avgROI: '0.0', listings: 0 };
    }
  }

  async getPartnerLiveFunding(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];
    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id }, status: AssetStatus.APPROVED },
    });

    return Promise.all(
      assets.map(async (a) => {
        const stats = await this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(CAST(inv.amount AS NUMERIC))', 'raised')
          .where('inv.assetId = :id', { id: a.id })
          .andWhere('inv.status != :pending', {
            pending: InvestmentStatus.PENDING,
          })
          .getRawOne();
        return {
          id: a.id,
          name: a.title,
          target: Number(a.totalValue),
          raised: parseFloat(stats?.raised || '0'),
          stage: 'Funding',
        };
      }),
    );
  }

  async getPartnerFundingTable(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];
    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    return Promise.all(
      assets.map(async (a) => {
        const stats = await this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(CAST(inv.amount AS NUMERIC))', 'raised')
          .addSelect('COUNT(DISTINCT inv.investorId)', 'investors')
          .where('inv.assetId = :id', { id: a.id })
          .andWhere('inv.status != :pending', {
            pending: InvestmentStatus.PENDING,
          })
          .getRawOne();
        return {
          id: a.id,
          name: a.title,
          target: Number(a.totalValue),
          raised: parseFloat(stats?.raised || '0'),
          investors: parseInt(stats?.investors || '0'),
          status: a.status,
        };
      }),
    );
  }

  async getPartnerFunding(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];
    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      assets.map(async (a) => {
        const stats = await this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(CAST(inv.amount AS NUMERIC))', 'raised')
          .addSelect('COUNT(DISTINCT inv.investorId)', 'investors')
          .where('inv.assetId = :id', { id: a.id })
          .andWhere('inv.status = :confirmed', {
            confirmed: InvestmentStatus.CONFIRMED,
          })
          .getRawOne();

        const raisedAmount = parseFloat(stats?.raised || '0');
        const targetAmount = Number(a.totalValue) || 0;
        let stage = 'Approved';
        if (a.status === AssetStatus.SUBMITTED) stage = 'Compliance';
        else if (a.status === AssetStatus.REJECTED) stage = 'Rejected';
        else if (
          a.status === AssetStatus.FREEZ ||
          a.status === AssetStatus.PAID ||
          raisedAmount >= targetAmount
        )
          stage = 'Completed';
        else if (a.status === AssetStatus.APPROVED) stage = 'Funding';

        return {
          id: a.id,
          asset: a.title,
          target: targetAmount,
          raised: raisedAmount,
          roi: Number(a.expectedYield || 0),
          investors: parseInt(stats?.investors || '0'),
          stage: stage,
        };
      }),
    );
  }

  async getPartnerDistributions(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];
    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { updatedAt: 'DESC' },
    });

    return Promise.all(
      assets.map(async (a) => {
        const stats = await this.investmentRepo
          .createQueryBuilder('inv')
          .select('SUM(CAST(inv.amount AS NUMERIC))', 'raised')
          .addSelect('COUNT(DISTINCT inv.investorId)', 'investors')
          .where('inv.assetId = :id', { id: a.id })
          .andWhere('inv.status = :confirmed', {
            confirmed: InvestmentStatus.CONFIRMED,
          })
          .getRawOne();

        const raisedAmount = parseFloat(stats?.raised || '0');
        const targetAmount = Number(a.totalValue) || 0;
        let stage = 'Approved';
        if (a.status === AssetStatus.SUBMITTED) stage = 'Compliance';
        else if (
          raisedAmount >= targetAmount ||
          a.status === AssetStatus.FREEZ ||
          a.status === AssetStatus.PAID
        )
          stage = 'Completed';
        else if (a.status === AssetStatus.APPROVED) stage = 'Funding';

        let nextPayout = 'TBD';
        if (stage === 'Completed') {
          const now = new Date();
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          nextPayout = nextMonth.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
        }
        return {
          id: a.id,
          asset: a.title,
          stage: stage,
          totalRaised: raisedAmount,
          investors: parseInt(stats?.investors || '0'),
          nextPayout: nextPayout,
        };
      }),
    );
  }

  // --- DOCUMENTS & ADMINISTRATIVE ---

  /**
   * ✅ FIXED: Used destructuring to avoid the 'delete' TypeScript error.
   */
  async getAssetById(
    assetId: string,
    requesterId?: string,
    isAdmin = false,
  ): Promise<any> {
    if (!this.isValidUuid(assetId)) throw new NotFoundException('Invalid ID');

    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['partner', 'partner.user'],
    });
    if (!asset) throw new NotFoundException('Not found');

    const stats = await this.investmentRepo
      .createQueryBuilder('inv')
      .select('SUM(CAST(inv.amount AS NUMERIC))', 'raised')
      .addSelect('COUNT(DISTINCT inv.investorId)', 'investors')
      .where('inv.assetId = :id', { id: assetId })
      .andWhere('inv.status != :pending', { pending: InvestmentStatus.PENDING })
      .getRawOne();

    // 🛡️ SECURITY CHECK
    const isPartnerOwner = requesterId === asset.partner.user.id;
    const isInvestor = requesterId
      ? await this.investmentRepo.findOne({
          where: {
            asset: { id: assetId },
            investor: { user: { id: requesterId } },
            status: InvestmentStatus.CONFIRMED,
          },
        })
      : false;

    const hasAccess = isAdmin || isPartnerOwner || !!isInvestor;

    const response = {
      ...asset,
      funding: {
        target: Number(asset.totalValue),
        raised: parseFloat(stats?.raised || '0'),
        investors: parseInt(stats?.investors || '0'),
      },
      documents: [
        ...(asset.legalDocuments || []).map((url, i) => ({
          title: `Legal Doc ${i + 1}`,
          url: hasAccess ? url : null,
          type: 'Legal',
          locked: !hasAccess,
        })),
        ...(asset.financialDocuments || []).map((url, i) => ({
          title: `Financial Report ${i + 1}`,
          url: hasAccess ? url : null,
          type: 'Financial',
          locked: !hasAccess,
        })),
        ...(asset.otherDocuments || []).map((url, i) => ({
          title: `Supporting Doc ${i + 1}`,
          url,
          type: 'Other',
          locked: false,
        })),
      ],
    };

    // ✅ REPLACED 'DELETE' WITH DESTRUCTURING FOR COMPLIANCE
    if (!hasAccess) {
      const {
        legalDocuments: _l,
        financialDocuments: _f,
        ...safeResponse
      } = response;
      return safeResponse;
    }

    return response;
  }

  async getPartnerDocuments(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });
    if (!partner) return [];
    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });
    const allDocs: any[] = [];
    assets.forEach((asset) => {
      asset.legalDocuments?.forEach((url, i) =>
        allDocs.push({
          id: `${asset.id}-legal-${i}`,
          title: `${asset.title} - Legal Doc ${i + 1}`,
          type: 'Agreement',
          status: this.mapAssetStatusToDoc(asset.status),
          uploaded: new Date(asset.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          description: `Official legal documentation for ${asset.title}.`,
          url: url,
        }),
      );
      asset.financialDocuments?.forEach((url, i) =>
        allDocs.push({
          id: `${asset.id}-fin-${i}`,
          title: `${asset.title} - Financial ${i + 1}`,
          type: 'Report',
          status: this.mapAssetStatusToDoc(asset.status),
          uploaded: new Date(asset.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          description: `Financial audit and projection reports for ${asset.title}.`,
          url: url,
        }),
      );
      asset.otherDocuments?.forEach((url, i) =>
        allDocs.push({
          id: `${asset.id}-other-${i}`,
          title: `${asset.title} - Certificate ${i + 1}`,
          type: 'Certificate',
          status: this.mapAssetStatusToDoc(asset.status),
          uploaded: new Date(asset.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          description: `Additional certification docs for ${asset.title}.`,
          url: url,
        }),
      );
    });
    return allDocs;
  }

  /**
   * ✅ UPDATED: Atomic Approval & Tokenization
   */
  async approve(assetId: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['partner', 'partner.user'],
    });

    if (!asset) throw new NotFoundException('Asset not found');

    // Simple status update - go back to how you had your tokenization triggered
    asset.status = AssetStatus.APPROVED;
    const updatedAsset = await this.assetRepo.save(asset);

    if (updatedAsset.partner?.user?.id) {
      await this.notificationOrchestrator.buildAndSave(
        updatedAsset.partner.user.id,
        'asset.approved',
        { asset: updatedAsset.title },
      );
    }
    return updatedAsset;
  }

  async freeze(assetId: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException();
    asset.status = AssetStatus.FREEZ;
    return this.assetRepo.save(asset);
  }

  async reject(assetId: string, reason: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException();
    asset.status = AssetStatus.REJECTED;
    asset.rejectionReason = reason;
    return this.assetRepo.save(asset);
  }

  async getApprovedAssets(): Promise<Asset[]> {
    return this.assetRepo.find({
      where: { status: AssetStatus.APPROVED },
      relations: ['partner'],
      order: { createdAt: 'DESC' },
    });
  }

  async getByPartner(partnerId: string): Promise<Asset[]> {
    return this.assetRepo.find({
      where: { partner: { id: partnerId } },
      relations: ['partner'],
      order: { createdAt: 'DESC' },
    });
  }

  async countAssets(): Promise<number> {
    return this.assetRepo.count();
  }

  async findAllPending() {
    return this.assetRepo.find({
      where: { status: AssetStatus.SUBMITTED },
      relations: ['partner'],
    });
  }

  async getPipelineStats() {
    const [dueDiligence, awaitingTokenization] = await Promise.all([
      this.assetRepo.count({ where: { status: AssetStatus.SUBMITTED } }),
      this.assetRepo.count({
        where: { status: AssetStatus.APPROVED, funded: 0 },
      }),
    ]);
    return { dueDiligence, awaitingTokenization };
  }

  async findPartnerAssetsForDistribution(userId: string) {
    return this.assetRepo.find({
      where: { partner: { user: { id: userId } } },
      relations: ['investments', 'partner'],
    });
  }
}
