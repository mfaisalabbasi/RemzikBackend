// src/tokenization/tokenization.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetToken } from './entities/asset-token.entity';
import { Asset } from '../asset/asset.entity';
import { CreateTokenizationDto } from './dto/create-tokenization.dto';
import { AssetStatus } from '../asset/enums/asset-status.enum';
import { BlockchainService } from '../blockchain/blockchain.service'; // NEW
import { ConfigService } from '@nestjs/config'; // NEW

@Injectable()
export class TokenizationService {
  constructor(
    @InjectRepository(AssetToken)
    private readonly tokenRepo: Repository<AssetToken>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly blockchainService: BlockchainService, // Inject it here
    private readonly configService: ConfigService, // To get Treasury Address
  ) {}

  async tokenizeAsset(assetId: string, dto: CreateTokenizationDto) {
    // 1. Fetch Asset (need relations for metadata/partner info)
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['partner'],
    });

    if (!asset) throw new BadRequestException('Asset not found');
    if (asset.status !== AssetStatus.APPROVED) {
      throw new BadRequestException(
        'Asset must be APPROVED before tokenization.',
      );
    }

    // 2. BLOCKCHAIN DEPLOYMENT (Do this BEFORE DB transaction so we don't lock DB)
    const treasury = this.configService.get<string>('PLATFORM_TREASURY_WALLET');
    if (!treasury) throw new Error('PLATFORM_TREASURY_WALLET not configured');

    // Deploy contract using values from your dto and asset
    const tokenAddress = await this.blockchainService.deployAssetContract(
      asset.title,
      asset.symbol || 'RXZ', // Fallback
      BigInt(dto.totalShares) * BigInt(1e18),
      'ipfs://metadata-hash', // Replace with dynamic hash if you have one
      treasury,
    );

    // 3. ATOMIC DB TRANSACTION
    return await this.assetRepo.manager.transaction(async (manager) => {
      const existing = await manager.findOne(AssetToken, {
        where: { asset: { id: assetId } },
      });

      if (existing)
        throw new BadRequestException('Asset ledger already initialized.');

      // Create Token record
      const token = manager.create(AssetToken, {
        asset,
        totalShares: dto.totalShares,
        sharePrice: dto.sharePrice,
        availableShares: dto.totalShares,
        tokenAddress: tokenAddress, // Save the contract address to DB
      });

      await manager.save(token);

      // Update Asset record
      asset.tokenAddress = tokenAddress;
      await manager.save(asset);

      return { success: true, tokenAddress };
    });
  }
}
