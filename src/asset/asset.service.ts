import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Asset } from './asset.entity';
import { CreateAssetDto } from './dto/create-asset.dto';

import { PartnerProfile } from 'src/partner/partner.entity';
import { AssetStatus } from './enums/asset-status.enum';

import { StorageService } from '../storage/storage.service';

@Injectable()
export class AssetService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,

    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,

    private readonly storageService: StorageService,
  ) {}

  /**
   * Helper for uploading file arrays
   */
  private async uploadFiles(
    fileList: Express.Multer.File[] | undefined,
    folder: string,
  ): Promise<string[]> {
    const urls: string[] = [];

    if (!fileList || fileList.length === 0) {
      return urls;
    }

    for (const file of fileList) {
      const url = await this.storageService.uploadFile(file, folder);
      urls.push(url);
    }

    return urls;
  }

  /**
   * Partner submits asset
   */
  async createAsset(
    userId: string,
    dto: CreateAssetDto,
    files: {
      galleryImages?: Express.Multer.File[];
      legalDocuments?: Express.Multer.File[];
      financialDocuments?: Express.Multer.File[];
      otherDocuments?: Express.Multer.File[];
    },
  ): Promise<Asset> {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const galleryImages = await this.uploadFiles(
      files.galleryImages,
      'assets/gallery',
    );

    const legalDocuments = await this.uploadFiles(
      files.legalDocuments,
      'assets/legal',
    );

    const financialDocuments = await this.uploadFiles(
      files.financialDocuments,
      'assets/financial',
    );

    const otherDocuments = await this.uploadFiles(
      files.otherDocuments,
      'assets/other',
    );

    const asset = this.assetRepo.create({
      title: dto.title,
      type: dto.type,
      description: dto.description,
      totalValue: Number(dto.totalValue),

      partner,
      galleryImages,
      legalDocuments,
      financialDocuments,
      otherDocuments,

      status: AssetStatus.SUBMITTED,

      location: dto.location ?? null,
      expectedYield: dto.expectedYield ?? null,
      rentalIncome: dto.rentalIncome ?? null,
      assetSize: dto.assetSize ?? null,
      tokenSupply: dto.tokenSupply ?? null,
    });

    return this.assetRepo.save(asset);
  }

  /**
   * Admin approves asset
   */
  async approve(assetId: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    asset.status = AssetStatus.APPROVED;

    return this.assetRepo.save(asset);
  }

  /**
   * Admin freezes asset
   */
  async freeze(assetId: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    asset.status = AssetStatus.FREEZ;

    return this.assetRepo.save(asset);
  }

  /**
   * Admin reject asset
   */
  async reject(assetId: string, reason: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    asset.status = AssetStatus.REJECTED;
    asset.rejectionReason = reason;

    return this.assetRepo.save(asset);
  }

  /**
   * Investors browse approved assets
   */
  async getApprovedAssets(): Promise<Asset[]> {
    return this.assetRepo.find({
      where: { status: AssetStatus.APPROVED },
      relations: ['partner'],
    });
  }

  /**
   * Partner dashboard assets
   */
  async getByPartner(partnerId: string): Promise<Asset[]> {
    return this.assetRepo.find({
      where: { partner: { id: partnerId } },
      relations: ['partner'],
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Analytics
   */
  async countAssets(): Promise<number> {
    return this.assetRepo.count();
  }

  /**
   * ✅ NEW: Partner Performance (Dashboard Cards)
   */
  async getPartnerPerformance(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    // real calculations (fallback to dummy if empty)
    const totalValue = assets.reduce(
      (sum, a) => sum + (a.totalValue || 0) * 0.6, // simulate 60% funded
      0,
    );

    const avgROI =
      assets.length > 0
        ? (
            assets.reduce((sum, a) => sum + (a.expectedYield || 0), 0) /
            assets.length
          ).toFixed(2)
        : '8.4';

    return {
      totalFunding:
        // totalValue ||
        1240000, // fallback dummy
      investors: 348, // dummy (future investment module)
      avgROI:
        //  avgROI ||
        9,
      listings: assets.length || 3,
    };
  }

  async getPartnerKPI(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    const totalAssets = assets.length;

    const approvedAssets = assets.filter(
      (a) => a.status === AssetStatus.APPROVED,
    );

    const pendingAssets = assets.filter(
      (a) => a.status === AssetStatus.SUBMITTED,
    );

    // simulate funding states (for now)
    const activeFunding = approvedAssets.length; // approved = funding
    const fullyFunded = Math.floor(approvedAssets.length / 2); // dummy split

    const totalRaised = assets.reduce(
      (sum, a) => sum + (a.totalValue || 0) * 0.6, // simulate 60% funded
      0,
    );

    const avgROI =
      assets.length > 0
        ? (
            assets.reduce((sum, a) => sum + (a.expectedYield || 0), 0) /
            assets.length
          ).toFixed(2)
        : 8.2;

    return {
      totalAssets,
      activeFunding,
      fullyFunded,
      pendingCompliance: pendingAssets.length,
      totalRaised: 1000,
      avgROI: 9,
    };
  }

  /**
   * ✅ Partner Live Funding Assets
   */
  async getPartnerLiveFunding(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    // only approved assets → considered "live funding"
    const liveAssets = assets.filter(
      (a) =>
        a.status === AssetStatus.APPROVED || a.status === AssetStatus.SUBMITTED, // 👈 allow submitted for now
    );

    // map into frontend format
    return liveAssets.map((asset) => {
      const target = asset.totalValue || 0;

      // simulate funding progress (40% - 80%)
      const raised = Math.floor(target * (0.4 + Math.random() * 0.4));

      return {
        id: asset.id,
        name: asset.title,
        target,
        raised,
        stage: 'Funding', // future: dynamic lifecycle
      };
    });
  }

  /**
   * ✅ Partner Funding Table
   */
  async getPartnerFundingTable(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    return assets.map((asset) => {
      const target = asset.totalValue || 0;

      // simulate funding (40%–90%)
      const raised = Math.floor(target * (0.4 + Math.random() * 0.5));

      // simulate investors
      const investors = Math.floor(raised / 10000);

      let status = 'PENDING';

      if (asset.status === AssetStatus.APPROVED) {
        status = 'FUNDING';
      }

      if (raised >= target) {
        status = 'FUNDED';
      }

      return {
        id: asset.id,
        name: asset.title,
        target,
        raised,
        investors,
        status,
      };
    });
  }

  /**
   * ✅ Recent Activity Feed (mock for now)
   */
  async getRecentActivity(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    // take first few assets and simulate activity
    return assets.slice(0, 5).map((asset, i) => ({
      investorName: `Investor ${i + 1}`,
      assetName: asset.title,
      amount: Math.floor(5000 + Math.random() * 20000),
      date: `${1 + i}h ago`,
    }));
  }
  /**
   * ✅ Partner Assets List (for dashboard page)
   */
  async getPartnerAssets(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    return assets.map((asset) => {
      const target = asset.totalValue || 0;

      // simulate funding (same logic used everywhere)
      const raised = Math.floor(target * (0.4 + Math.random() * 0.5));

      const investors = Math.floor(raised / 10000);

      // map backend status → frontend stage
      let stage = 'Pending';

      if (asset.status === AssetStatus.SUBMITTED) stage = 'Pending';
      if (asset.status === AssetStatus.APPROVED) stage = 'Funding';
      if (raised >= target) stage = 'Completed';

      return {
        id: asset.id,
        name: asset.title,
        type: asset.type,
        stage,
        target,
        raised,
        roi: asset.expectedYield || 8,
        investors,
      };
    });
  }

  /**
   * ✅ Partner Investors (simulated from assets)
   */
  async getPartnerInvestors(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    const investors: any[] = [];

    assets.forEach((asset, index) => {
      const target = asset.totalValue || 100000;

      // simulate 3–6 investors per asset
      const count = 3 + Math.floor(Math.random() * 4);

      for (let i = 0; i < count; i++) {
        const invested = Math.floor(5000 + Math.random() * 50000);

        investors.push({
          id: `${asset.id}-${i}`,
          name: `Investor ${index + 1}-${i + 1}`,
          asset: asset.title,
          invested,
          ownership: ((invested / target) * 100).toFixed(2) + '%',
          status: this.getInvestorStatus(),
        });
      }
    });

    return investors;
  }

  /**
   * helper
   */
  private getInvestorStatus(): string {
    const statuses = ['Active', 'Pending', 'Exited'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  /**
   * ✅ Partner Withdrawal Requests
   */
  private getWithdrawalStatus(): string {
    const statuses = ['Pending', 'Approved', 'Rejected', 'Completed'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }
  async getWithdrawalRequests(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    const withdrawals: any[] = [];

    assets.forEach((asset, index) => {
      const count = 1 + Math.floor(Math.random() * 3);

      for (let i = 0; i < count; i++) {
        withdrawals.push({
          id: `${asset.id}-wd-${i}`,
          asset: asset.title,
          amount: Math.floor(5000 + Math.random() * 50000),
          status: this.getWithdrawalStatus(),
          date: `${1 + i}d ago`,
        });
      }
    });

    return withdrawals;
  }

  /**
   * ✅ Partner Funding Progress (detailed page)
   */
  async getPartnerFunding(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    return assets.map((asset) => {
      const target = asset.totalValue || 0;

      // same simulation logic (keep consistency across app)
      const raised = Math.floor(target * (0.4 + Math.random() * 0.5));

      const investors = Math.floor(raised / 10000);

      let stage = 'Pending';

      if (asset.status === AssetStatus.SUBMITTED) stage = 'Pending';
      if (asset.status === AssetStatus.APPROVED) stage = 'Funding';
      if (raised >= target) stage = 'Completed';

      return {
        id: asset.id,
        asset: asset.title,
        target,
        raised,
        roi: asset.expectedYield || 8,
        investors,
        stage,
      };
    });
  }

  /**
   * ✅ Partner Distribution Data
   */
  async getPartnerDistributions(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
      order: { createdAt: 'DESC' },
    });

    return assets.map((asset, index) => {
      const target = asset.totalValue || 0;

      // keep SAME logic as funding (consistency)
      const raised = Math.floor(target * (0.4 + Math.random() * 0.5));
      const investors = Math.floor(raised / 10000);

      let stage = 'Pending';

      if (asset.status === AssetStatus.SUBMITTED) stage = 'Pending';
      if (asset.status === AssetStatus.APPROVED) stage = 'Funding';
      if (raised >= target) stage = 'Completed';

      // simulate payout date
      let nextPayout = 'TBD';

      if (stage === 'Funding') {
        nextPayout = 'After funding completion';
      } else if (stage === 'Completed') {
        const days = 10 + Math.floor(Math.random() * 20);
        const date = new Date();
        date.setDate(date.getDate() + days);

        nextPayout = date.toLocaleDateString();
      }

      return {
        id: asset.id,
        asset: asset.title,
        stage,
        totalRaised: raised,
        investors,
        nextPayout,
      };
    });
  }

  async getPartnerDocuments(userId: string) {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: partner.id } },
    });

    const docs: any[] = [];

    assets.forEach((asset) => {
      // Map gallery images
      (asset.galleryImages || []).forEach((url, index) => {
        docs.push({
          id: `${asset.id}-gallery-${index}`,
          title: `Gallery Image ${index + 1}`,
          type: 'gallery',
          status: asset.status,
          uploaded: asset.createdAt,
          fileUrl: url,
          asset: asset.title,
        });
      });

      // Map legal documents
      (asset.legalDocuments || []).forEach((url, index) => {
        docs.push({
          id: `${asset.id}-legal-${index}`,
          title: `Legal Document ${index + 1}`,
          type: 'legal',
          status: asset.status,
          uploaded: asset.createdAt,
          fileUrl: url,
          asset: asset.title,
        });
      });

      // Map financial documents
      (asset.financialDocuments || []).forEach((url, index) => {
        docs.push({
          id: `${asset.id}-financial-${index}`,
          title: `Financial Document ${index + 1}`,
          type: 'financial',
          status: asset.status,
          uploaded: asset.createdAt,
          fileUrl: url,
          asset: asset.title,
        });
      });

      // Map other documents
      (asset.otherDocuments || []).forEach((url, index) => {
        docs.push({
          id: `${asset.id}-other-${index}`,
          title: `Other Document ${index + 1}`,
          type: 'other',
          status: asset.status,
          uploaded: asset.createdAt,
          fileUrl: url,
          asset: asset.title,
        });
      });
    });

    return docs;
  }
}
