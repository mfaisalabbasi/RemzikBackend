import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Distribution } from '../../../distribution/distribution.entity';
import { PayoutStatus } from '../../../distribution/enums/payout-status.enum';
import { ethers } from 'ethers'; // 👈 Used for decoding bytes32 batch IDs emitted by Solidity

@Injectable()
export class YieldHandler {
  private readonly logger = new Logger(YieldHandler.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * 🛡️ Safely decodes a Solidity bytes32 hex string back into a plaintext batch ID,
   * falling back cleanly if it's already a plain string.
   */
  private safeDecodeBatchId(rawBatchId: string): string {
    try {
      if (
        rawBatchId &&
        rawBatchId.startsWith('0x') &&
        rawBatchId.length === 66
      ) {
        return ethers.decodeBytes32String(rawBatchId).replace(/\u0000/g, ''); // Trim padding null bytes
      }
    } catch (e) {
      // Fallback if already a regular string
    }
    return rawBatchId;
  }

  async handleYieldRecorded(data: {
    batchId: string;
    propertyAddress: string;
    totalNetYield: string;
    txHash: string;
  }) {
    const cleanBatchId = this.safeDecodeBatchId(data.batchId);
    this.logger.log(
      `💰 [Index] YieldRecorded on-chain: Batch=${cleanBatchId}, Property=${data.propertyAddress}, Yield=${data.totalNetYield}, Tx: ${data.txHash}`,
    );

    await this.dataSource.transaction(async (manager) => {
      const distributions = await manager
        .getRepository(Distribution)
        .createQueryBuilder('dist')
        .setLock('pessimistic_write')
        .where('dist.batchId = :batchId', { batchId: cleanBatchId })
        .getMany();

      if (distributions.length === 0) {
        this.logger.warn(
          `⚠️ YieldRecorded event received for batch ${cleanBatchId}, but no matching distribution records found in DB.`,
        );
        return;
      }

      // 🛡️ Idempotency check: If already marked PAID, skip redundant execution
      if (distributions[0].status === PayoutStatus.PAID) {
        this.logger.log(
          `ℹ️ Batch ${cleanBatchId} already reconciled on-chain. Skipping duplicate execution.`,
        );
        return;
      }

      // Update all associated payouts in this batch to PAID
      for (const dist of distributions) {
        if (dist.distributionMode === 'OFF_CHAIN') {
          dist.status = PayoutStatus.PAID;
          await manager.save(dist);
        }
      }

      this.logger.log(
        `✅ Successfully reconciled ${distributions.length} payout records for batch ${cleanBatchId} with on-chain tx: ${data.txHash}`,
      );
    });
  }

  // ✅ Handler for Merkle-backed batch recording events emitted by YieldNotary
  async handleYieldBatchMerkleRecorded(data: {
    batchId: string;
    propertyAddress: string;
    merkleRoot: string;
    totalAmount: string;
    txHash: string;
  }) {
    const cleanBatchId = this.safeDecodeBatchId(data.batchId);
    this.logger.log(
      `🔗 [Index] YieldBatchMerkleRecorded on-chain: Batch=${cleanBatchId}, Root=${data.merkleRoot}, Tx: ${data.txHash}`,
    );

    await this.dataSource.transaction(async (manager) => {
      const distributions = await manager
        .getRepository(Distribution)
        .createQueryBuilder('dist')
        .setLock('pessimistic_write')
        .where('dist.batchId = :batchId', { batchId: cleanBatchId })
        .getMany();

      if (distributions.length === 0) {
        this.logger.warn(
          `⚠️ YieldBatchMerkleRecorded event received for batch ${cleanBatchId}, but no matching distribution records found in DB.`,
        );
        return;
      }

      for (const dist of distributions) {
        if (
          dist.distributionMode === 'ON_CHAIN' &&
          dist.status === PayoutStatus.PENDING
        ) {
          // Keep status PENDING to allow trustless user-initiated claims via Merkle proof
          await manager.save(dist);
        }
      }

      this.logger.log(
        `✅ Merkle batch ${cleanBatchId} successfully indexed and anchored on-chain.`,
      );
    });
  }

  // ✅ Handler for individual trustless claims made by users on-chain
  async handleYieldClaimed(data: {
    batchId: string;
    account: string;
    amount: string;
    txHash: string;
  }) {
    const cleanBatchId = this.safeDecodeBatchId(data.batchId);
    this.logger.log(
      `💸 [Index] YieldClaimed on-chain: Batch=${cleanBatchId}, Account=${data.account}, Amount=${data.amount}, Tx: ${data.txHash}`,
    );

    await this.dataSource.transaction(async (manager) => {
      const distribution = await manager
        .getRepository(Distribution)
        .createQueryBuilder('dist')
        .leftJoinAndSelect('dist.investor', 'investor')
        .leftJoinAndSelect('investor.user', 'user')
        .setLock('pessimistic_write')
        .where('dist.batchId = :batchId', { batchId: cleanBatchId })
        .andWhere('LOWER(user.walletAddress) = LOWER(:account)', {
          account: data.account,
        })
        .getOne();

      if (!distribution) {
        this.logger.warn(
          `⚠️ YieldClaimed event received for batch ${cleanBatchId} and account ${data.account}, but no matching distribution row found.`,
        );
        return;
      }

      // 🛡️ Idempotency guard: Prevent duplicate updates if already marked PAID
      if (distribution.status === PayoutStatus.PAID) {
        this.logger.log(
          `ℹ️ Claim for account ${data.account} in batch ${cleanBatchId} is already marked as PAID. Skipping duplicate.`,
        );
        return;
      }

      distribution.status = PayoutStatus.PAID;
      await manager.save(distribution);

      this.logger.log(
        `✅ Successfully marked on-chain claim as PAID for user ${data.account} in batch ${cleanBatchId} with tx: ${data.txHash}`,
      );
    });
  }
}
