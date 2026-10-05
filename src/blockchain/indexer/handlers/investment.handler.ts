import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Investment } from '../../../investment/investment.entity';
import { InvestmentStatus } from '../../../investment/enums/investment-status.enum';
import { OwnershipService } from '../../../ownership/ownership.service';
import { Ownership } from '../../../ownership/ownership.entity';
import { Asset } from '../../../asset/asset.entity';
import { InvestorProfile } from '../../../investor/investor.entity';
import { AssetToken } from '../../../tokenization/entities/asset-token.entity';

@Injectable()
export class InvestmentHandler {
  private readonly logger = new Logger(InvestmentHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ownershipService: OwnershipService,
  ) {}

  /**
   * Processes token release / transfer events from Treasury Vaults or Asset tokens.
   */
  async handleEvent(eventData: {
    tokenAddress: string;
    treasuryAddress: string;
    recipientWallet: string;
    amountUnits: string;
    txHash: string;
    blockNumber: number;
  }): Promise<void> {
    const {
      tokenAddress,
      treasuryAddress,
      recipientWallet,
      amountUnits,
      txHash,
      blockNumber,
    } = eventData;

    await this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. First, check if this specific txHash was already recorded (Idempotency guard)
      let existingInvestment = await manager.findOne(Investment, {
        where: { txHash },
        lock: { mode: 'pessimistic_write' },
      });

      if (existingInvestment) {
        if (existingInvestment.status !== InvestmentStatus.CONFIRMED) {
          existingInvestment.status = InvestmentStatus.CONFIRMED;
          await manager.save(existingInvestment);
        }
        this.logger.warn(
          `⚠️ Transaction ${txHash} already recorded. Skipping duplicate asset/share mutation.`,
        );
        return;
      }

      // 2. Resolve Investor Profile
      const investor = await manager.findOne(InvestorProfile, {
        where: { user: { walletAddress: recipientWallet } },
        relations: ['user'],
      });

      if (!investor) {
        this.logger.error(
          `❌ Investor profile not found for wallet: ${recipientWallet}`,
        );
        return;
      }

      // 3. Resolve Asset & its Token info using tokenAddress stored on Asset entity
      const asset = await manager.findOne(Asset, {
        where: { tokenAddress },
        relations: ['token'],
      });

      if (!asset || !asset.token) {
        this.logger.error(
          `❌ Asset or Token not found in DB for address: ${tokenAddress}`,
        );
        return;
      }

      const token = asset.token;
      const parsedUnits = Number(amountUnits);
      const totalCost = parsedUnits * Number(token.sharePrice);

      // Helper function to execute token lock down, funding updates, ownership allocation, and saving
      const processAssetMutationAndAllocation = async () => {
        // Decrement available shares atomically
        const lockedToken = await manager
          .getRepository(AssetToken)
          .createQueryBuilder('token')
          .setLock('pessimistic_write')
          .where('token.id = :id', { id: token.id })
          .getOne();

        if (lockedToken) {
          lockedToken.availableShares = Math.max(
            0,
            Number(lockedToken.availableShares) - parsedUnits,
          );
          await manager.save(lockedToken);
        }

        // Update Asset Funding Pool metrics
        asset.funded = Number(asset.funded) + totalCost;

        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: investor.id, assetId: asset.id },
        });

        if (!existingOwnership) {
          asset.investors = (asset.investors || 0) + 1;
        }
        await manager.save(asset);

        // Allocate shares via OwnershipService atomically
        await this.ownershipService.addShares(
          investor,
          asset,
          parsedUnits,
          manager,
        );
      };

      // 4. Check if there is a PENDING investment intent created by the API for this user/vault
      const pendingInvestment = await manager.findOne(Investment, {
        where: {
          investor: { id: investor.id },
          expectedVaultAddress: treasuryAddress,
          status: InvestmentStatus.PENDING,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (pendingInvestment) {
        // Link txHash and confirm existing pending intent
        pendingInvestment.txHash = txHash;
        pendingInvestment.status = InvestmentStatus.CONFIRMED;
        await manager.save(pendingInvestment);

        // Execute shared asset reduction and share allocation logic
        await processAssetMutationAndAllocation();

        this.logger.log(
          `✅ [InvestmentIndexer] Confirmed pending investment intent ${pendingInvestment.id} | Shares Allocated | Tx: ${txHash}`,
        );
        return;
      }

      // 5, 6, 7. Self-Healing Path: No API intent found, execute mutations
      await processAssetMutationAndAllocation();

      // 8. Save Confirmed Investment Record (Self-Healed)
      const newInvestment = manager.create(Investment, {
        investor,
        asset: { id: asset.id } as Asset,
        amount: totalCost,
        units: parsedUnits,
        unitPriceAtPurchase: Number(token.sharePrice),
        status: InvestmentStatus.CONFIRMED,
        txHash,
      });

      await manager.save(newInvestment);

      this.logger.log(
        `✅ [InvestmentIndexer Self-Healed] Synced token release for wallet ${recipientWallet} | Tx: ${txHash} | Block: ${blockNumber}`,
      );
    });
  }
}
