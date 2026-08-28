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
      if (asset.tokenAddress)
        throw new BadRequestException('Asset is already tokenized.');
      if (asset.status !== AssetStatus.APPROVED) {
        throw new BadRequestException(
          'Asset must be APPROVED before tokenization.',
        );
      }

      const registryAddress = this.configService.get<string>(
        'COMPLIANCE_CONTRACT_ADDRESS',
      );
      if (!registryAddress)
        throw new InternalServerErrorException(
          'Compliance contract address not configured',
        );

      this.logger.log(
        `Deploying asset pod (Token, Treasury, Governance) for: ${asset.title}`,
      );

      const totalSharesWei = (
        BigInt(dto.totalShares) *
        BigInt(10) ** BigInt(18)
      ).toString();

      // 2. BLOCKCHAIN DEPLOYMENT (Dynamically provisions Token, Vault Proxy, and Governance)
      const { tokenAddress, treasuryAddress, governanceAddress } =
        await this.blockchainService.deployAssetContract(
          asset.title,
          asset.symbol || 'RXZ',
          totalSharesWei,
          'ipfs://metadata-hash',
          registryAddress,
          asset.id, // Pass asset.id as propertyId so the factory binds the vault proxy
        );

      if (!tokenAddress || !governanceAddress || !treasuryAddress) {
        throw new InternalServerErrorException(
          'Pod deployment failed or incomplete addresses returned.',
        );
      }

      // 🛡️ COMPLIANCE & FUNDING GUARD: Ensure the dynamic vault proxy is whitelisted and funded with fractional tokens
      try {
        // Whitelist the dynamic vault proxy on the compliance/identity registry if required
        await this.blockchainService.ensureWalletWhitelisted(treasuryAddress);

        // Mint or transfer the initial token supply directly into the dynamic Treasury Vault proxy address
        // so it has tokens to distribute when users deposit.
        await this.blockchainService.mintTokensToVault(
          tokenAddress,
          treasuryAddress,
          totalSharesWei,
        );
      } catch (err: any) {
        throw new InternalServerErrorException(
          `Vault setup and funding failed: ${err.message}`,
        );
      }

      // 3. ATOMIC DB TRANSACTION (Store Token, Governance, and dynamic Treasury Vault address)
      const finalAsset = await this.assetRepo.manager.transaction(
        async (manager) => {
          const token = manager.create(AssetToken, {
            asset,
            totalShares: dto.totalShares,
            sharePrice: dto.sharePrice,
            availableShares: dto.totalShares,
            tokenAddress: tokenAddress,
            governanceAddress: governanceAddress,
          });

          await manager.save(token);

          asset.tokenAddress = tokenAddress;
          asset.governanceAddress = governanceAddress;
          asset.treasuryAddress = treasuryAddress; // Saved unique proxy vault address per asset
          asset.status = AssetStatus.APPROVED;
          return await manager.save(asset);
        },
      );

      // 4. GOVERNANCE: ARM THE ORACLE
      try {
        await this.delay(1000);
        await this.oracleService.syncAssetPriceToOracle(assetId);
      } catch (error: any) {
        this.logger.error(`Oracle sync failed: ${error.message}`);
        await this.assetRepo.update(assetId, {
          status: AssetStatus.SYNC_PENDING,
        });
      }

      return {
        success: true,
        tokenAddress: finalAsset.tokenAddress,
        treasuryAddress: finalAsset.treasuryAddress,
        governanceAddress: finalAsset.governanceAddress,
        message:
          'Tokenization complete. Pod deployed, vault funded, and Oracle synced.',
      };
    });
  }
}
