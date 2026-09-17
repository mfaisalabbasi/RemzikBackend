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
    const { tokenAddress, recipientWallet, amountUnits, txHash, blockNumber } =
      eventData;

    await this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Idempotency guard via txHash with pessimistic write lock to prevent race conditions with API
      const existingInvestment = await manager.findOne(Investment, {
        where: { txHash },
        lock: { mode: 'pessimistic_write' },
      });

      if (existingInvestment) {
        // If API already wrote it, ensure it's marked CONFIRMED and exit safely without double-counting
        if (existingInvestment.status !== InvestmentStatus.CONFIRMED) {
          existingInvestment.status = InvestmentStatus.CONFIRMED;
          await manager.save(existingInvestment);
        }
        this.logger.warn(
          `⚠️ Transaction ${txHash} already recorded. Skipping duplicate asset/share mutation.`,
        );
        return;
      }

      // 2. Self-Healing Path: API missed the event or user transacted directly on-chain
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

      // 4. Safely decrement available shares atomically on token for self-healing scenarios
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

      // 5. Update Asset Funding Pool metrics
      asset.funded = Number(asset.funded) + totalCost;

      const existingOwnership = await manager.findOne(Ownership, {
        where: { investorId: investor.id, assetId: asset.id },
      });

      if (!existingOwnership) {
        asset.investors = (asset.investors || 0) + 1;
      }
      await manager.save(asset);

      // 6. Allocate shares via OwnershipService atomically
      await this.ownershipService.addShares(
        investor,
        asset,
        parsedUnits,
        manager,
      );

      // 7. Save Confirmed Investment Record (Self-Healed)
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
