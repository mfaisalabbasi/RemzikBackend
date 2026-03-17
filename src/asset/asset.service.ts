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
}
