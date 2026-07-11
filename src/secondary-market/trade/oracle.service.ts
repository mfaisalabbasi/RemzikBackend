import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Mutex } from 'async-mutex';
import { Asset } from 'src/asset/asset.entity';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { AssetStatus } from 'src/asset/enums/asset-status.enum';

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);
  // Mutex ensures that even if multiple requests hit this service,
  // they are queued to respect blockchain nonce ordering.
  private readonly mutex = new Mutex();

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly blockchainService: BlockchainService,
  ) {}

  /**
   * Synchronizes the asset price bands with the on-chain PriceOracle.
   * Calculates a 10% buffer for price fluctuations.
   */
  async syncAssetPriceToOracle(assetId: string): Promise<string> {
    // 1. Fetch asset details
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });

    if (!asset || !asset.tokenAddress) {
      throw new InternalServerErrorException(
        `Asset ${assetId} not found or missing token address.`,
      );
    }

    const priceString = asset.unitPrice?.toString();
    if (!priceString || Number(priceString) <= 0) {
      throw new InternalServerErrorException(
        `Invalid unit price for asset ${assetId}: ${priceString}`,
      );
    }

    // 2. Calculate bounds (18-decimal precision)
    const price = ethers.parseUnits(priceString, 18);
    const min = (price * 90n) / 100n; // 10% lower buffer
    const max = (price * 110n) / 100n; // 10% upper buffer

    // 3. Execute blockchain sync inside Mutex to prevent nonce collisions
    return await this.mutex.runExclusive(async () => {
      try {
        this.logger.log(`Syncing price band to Oracle for asset: ${assetId}`);

        const receipt: any =
          await this.blockchainService.updatePriceBandOnChain(
            asset.tokenAddress,
            min.toString(),
            max.toString(),
          );

        const txHash: string = receipt.hash || receipt.transactionHash;

        // 4. Update database status on success
        await this.assetRepo.update(assetId, {
          status: AssetStatus.APPROVED,
          lastPriceSync: new Date(),
        });

        this.logger.log(
          `Price sync successful for asset ${assetId}. Hash: ${txHash}`,
        );
        return txHash;
      } catch (error: any) {
        this.logger.error(
          `Blockchain failure for asset ${assetId}: ${error.message}`,
        );

        // 5. Mark as SYNC_PENDING on failure for retry logic
        await this.assetRepo.update(assetId, {
          status: AssetStatus.SYNC_PENDING,
        });

        throw new InternalServerErrorException(
          `Blockchain price sync failed for asset ${assetId}.`,
        );
      }
    });
  }
}
