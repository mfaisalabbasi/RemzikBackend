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

@Injectable()
export class AssetService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,
  ) {}

  /**
   * Partner creates asset
   */
  async createAsset(userId: string, dto: CreateAssetDto): Promise<Asset> {
    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner) {
      throw new BadRequestException('Partner profile required');
    }

    const asset = this.assetRepo.create({
      ...dto,
      partner,
      status: AssetStatus.SUBMITTED,
    });

    return this.assetRepo.save(asset);
  }

  /**
   * Admin approval / rejection
   */
  async updateAssetStatus(
    assetId: string,
    status: AssetStatus,
  ): Promise<Asset> {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    asset.status = status;
    return this.assetRepo.save(asset);
  }

  /**
   * Public approved assets (for investors)
   */
  async getApprovedAssets(): Promise<Asset[]> {
    return this.assetRepo.find({
      where: { status: AssetStatus.APPROVED },
      relations: ['partner'],
    });
  }
}
