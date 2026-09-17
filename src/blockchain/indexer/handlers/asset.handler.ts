import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AssetStatus } from '../../../asset/enums/asset-status.enum';
import { Asset } from '../../../asset/asset.entity';

@Injectable()
export class AssetEventHandler {
  private readonly logger = new Logger(AssetEventHandler.name);

  constructor(private readonly dataSource: DataSource) {}

  async handleAssetPodDeployed(
    tokenAddress: string,
    treasuryAddress: string,
    governanceAddress: string,
    assetName: string,
    txHash: string,
  ): Promise<void> {
    const assetRepo = this.dataSource.getRepository(Asset);

    try {
      // 🛡️ Find asset by title/name or look up un-tokenized approved assets matching the deployment name
      let asset = await assetRepo.findOne({
        where: [
          { tokenAddress: tokenAddress },
          { title: assetName, status: AssetStatus.APPROVED },
        ],
      });

      if (!asset) {
        // Fallback: Pick the oldest APPROVED asset that doesn't have a token address yet
        asset = await assetRepo.findOne({
          where: { status: AssetStatus.APPROVED, tokenAddress: null as any },
          order: { createdAt: 'ASC' },
        });
      }

      if (!asset) {
        this.logger.warn(
          `⚠️ AssetPodDeployed event received for "${assetName}" (Token: ${tokenAddress}), but no matching asset found in DB. (Tx: ${txHash})`,
        );
        return;
      }

      // Check if already fully in sync to avoid redundant DB writes
      if (
        asset.tokenAddress === tokenAddress &&
        asset.treasuryAddress === treasuryAddress &&
        asset.governanceAddress === governanceAddress
      ) {
        return;
      }

      // Self-healing sync
      asset.tokenAddress = tokenAddress;
      asset.treasuryAddress = treasuryAddress;
      asset.governanceAddress = governanceAddress;
      asset.status = AssetStatus.APPROVED;

      await assetRepo.save(asset);

      this.logger.log(
        `✅ [Self-Healed] Asset Pod successfully synced for "${asset.title}" -> Token: ${tokenAddress} (Tx: ${txHash})`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to handle AssetPodDeployed event for token ${tokenAddress}: ${error.message}`,
        error.stack,
      );
    }
  }
}
