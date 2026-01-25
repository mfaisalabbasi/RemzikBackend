import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetToken } from './entities/asset-token.entity';
import { Asset } from '../asset/asset.entity';
import { CreateTokenizationDto } from './dto/create-tokenization.dto';
import { AssetStatus } from '../asset/enums/asset-status.enum';

@Injectable()
export class TokenizationService {
  constructor(
    @InjectRepository(AssetToken)
    private readonly tokenRepo: Repository<AssetToken>,

    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  /**
   * ADMIN tokenizes an asset
   */
  async tokenizeAsset(assetId: string, dto: CreateTokenizationDto) {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset || asset.status !== AssetStatus.APPROVED) {
      throw new BadRequestException('Asset not approved');
    }

    const existing = await this.tokenRepo.findOne({
      where: { asset: { id: assetId } },
    });

    if (existing) {
      throw new BadRequestException('Asset already tokenized');
    }

    const token = this.tokenRepo.create({
      asset,
      totalShares: dto.totalShares,
      sharePrice: dto.sharePrice,
      availableShares: dto.totalShares,
    });

    return this.tokenRepo.save(token);
  }
}
