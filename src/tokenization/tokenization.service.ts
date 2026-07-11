import {
  Injectable,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mutex } from 'async-mutex';
import { AssetToken } from './entities/asset-token.entity';
import { Asset } from '../asset/asset.entity';
import { CreateTokenizationDto } from './dto/create-tokenization.dto';
import { AssetStatus } from '../asset/enums/asset-status.enum';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '@nestjs/config';
import { OracleService } from 'src/secondary-market/trade/oracle.service';

@Injectable()
export class TokenizationService {
  private readonly logger = new Logger(TokenizationService.name);
  private readonly tokenizationMutex = new Mutex();

  // Helper to force a pause for Hardhat automining state propagation
  private delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  constructor(
    @InjectRepository(AssetToken)
    private readonly tokenRepo: Repository<AssetToken>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly oracleService: OracleService,
  ) {}

  async tokenizeAsset(assetId: string, dto: CreateTokenizationDto) {
    return await this.tokenizationMutex.runExclusive(async () => {
      // 1. Fetch and Validate
      const asset = await this.assetRepo.findOne({
        where: { id: assetId },
        relations: ['partner'],
      });

      if (!asset) throw new BadRequestException('Asset not found');
      if (asset.tokenAddress) {
        throw new BadRequestException('Asset is already tokenized.');
      }
      if (asset.status !== AssetStatus.APPROVED) {
        throw new BadRequestException(
          'Asset must be APPROVED before tokenization.',
        );
      }

      // 2. BLOCKCHAIN DEPLOYMENT
      const treasury = this.configService.get<string>(
        'PLATFORM_TREASURY_WALLET',
      );
      if (!treasury)
        throw new InternalServerErrorException(
          'Treasury wallet not configured',
        );

      this.logger.log(`Deploying asset contract for: ${asset.title}`);

      const totalSharesWei = (
        BigInt(dto.totalShares) *
        BigInt(10) ** BigInt(18)
      ).toString();

      const tokenAddress = await this.blockchainService.deployAssetContract(
        asset.title,
        asset.symbol || 'RXZ',
        totalSharesWei,
        'ipfs://metadata-hash',
        treasury,
      );

      if (!tokenAddress) {
        throw new InternalServerErrorException('Contract deployment failed.');
      }

      // 3. ATOMIC DB TRANSACTION
      const finalAsset = await this.assetRepo.manager.transaction(
        async (manager) => {
          const token = manager.create(AssetToken, {
            asset,
            totalShares: dto.totalShares,
            sharePrice: dto.sharePrice,
            availableShares: dto.totalShares,
            tokenAddress: tokenAddress,
          });

          await manager.save(token);

          asset.tokenAddress = tokenAddress;
          asset.status = AssetStatus.APPROVED;
          return await manager.save(asset);
        },
      );

      // 4. GOVERNANCE: ARM THE ORACLE
      try {
        this.logger.log(`Syncing price band to Oracle for asset: ${assetId}`);

        // IMPORTANT: Wait for automining state to propagate before next transaction
        await this.delay(1000);

        await this.oracleService.syncAssetPriceToOracle(assetId);
        this.logger.log(`Oracle successfully armed for asset: ${assetId}`);
      } catch (error: any) {
        this.logger.error(
          `Oracle sync failed for asset ${assetId}: ${error.message}`,
        );

        await this.assetRepo.update(assetId, {
          status: AssetStatus.SYNC_PENDING,
        });
      }

      return {
        success: true,
        tokenAddress: finalAsset.tokenAddress,
        message: 'Tokenization complete. Oracle sync triggered.',
      };
    });
  }
}
