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

  async tokenizeAsset(assetId: string, dto: CreateTokenizationDto) {
    return await this.assetRepo.manager.transaction(async (manager) => {
      // 1. Find Asset
      const asset = await manager.findOne(Asset, { where: { id: assetId } });
      if (!asset) throw new BadRequestException('Asset not found');

      // 2. Strict Check for existing Token (The 'Already Initialized' Guard)
      const existing = await manager.findOne(AssetToken, {
        where: { asset: { id: assetId } },
      });

      if (existing) {
        throw new BadRequestException('Asset ledger is already initialized.');
      }

      // 3. Create the Token record (This makes it show up in Investing List)
      const token = manager.create(AssetToken, {
        asset,
        totalShares: dto.totalShares,
        sharePrice: dto.sharePrice,
        availableShares: dto.totalShares,
      });

      const savedToken = await manager.save(token);

      // 4. Update Asset Status (Keeping it APPROVED as you requested)
      asset.status = AssetStatus.APPROVED;
      await manager.save(asset);

      return savedToken;
    });
  }
}
