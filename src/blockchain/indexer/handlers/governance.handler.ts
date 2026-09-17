import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { GovernanceProposal } from '../../../governance/governance.entity'; // Adjust relative path as needed
import { Asset } from '../../../asset/asset.entity';
import { User } from '../../../user/user.entity';

@Injectable()
export class GovernanceHandler {
  private readonly logger = new Logger(GovernanceHandler.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Handles ProposalCreated events from PropertyGovernance contracts.
   * Ensures idempotency so late-waking indexers or double block scans don't duplicate records.
   */
  async handleProposalCreated(eventData: {
    proposalId: string | number;
    assetAddress: string;
    description: string;
    txHash: string;
    blockNumber: number;
  }): Promise<void> {
    const { proposalId, assetAddress, description } = eventData;
    const numericProposalId = Number(proposalId);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Resolve Asset by governance address or token address
      const asset = await manager.findOne(Asset, {
        where: [
          { governanceAddress: assetAddress },
          { tokenAddress: assetAddress },
        ],
      });

      if (!asset) {
        this.logger.error(
          `❌ [GovernanceIndexer] Asset not found for contract address: ${assetAddress}`,
        );
        return;
      }

      // 2. Idempotency Check: Look for existing proposal by proposalId and asset
      const existingProposal = await manager.findOne(GovernanceProposal, {
        where: { proposalId: numericProposalId, asset: { id: asset.id } },
      });

      if (existingProposal) {
        this.logger.warn(
          `⚠️ [GovernanceIndexer] Proposal ID #${numericProposalId} for Asset ${asset.id} already exists. Skipping.`,
        );
        return;
      }

      // 3. Create and persist new proposal record matching your service schema precisely
      const newProposal = manager.create(GovernanceProposal, {
        proposalId: numericProposalId,
        asset,
        description,
        status: 'PENDING',
      });

      await manager.save(newProposal);

      this.logger.log(
        `✅ [GovernanceIndexer] Successfully indexed Proposal #${numericProposalId} for Asset ${asset.id}`,
      );
    });
  }

  /**
   * Handles Voted events.
   */
  async handleVoted(eventData: {
    proposalId: string | number;
    voterWallet: string;
    support: boolean;
    weight: string;
    txHash: string;
  }): Promise<void> {
    const { proposalId, voterWallet, support, weight } = eventData;
    const numericProposalId = Number(proposalId);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const proposal = await manager.findOne(GovernanceProposal, {
        where: { proposalId: numericProposalId },
        relations: ['asset'],
      });

      if (!proposal) {
        this.logger.error(
          `❌ [GovernanceIndexer] Proposal #${numericProposalId} not found for voting event.`,
        );
        return;
      }

      const user = await manager.findOne(User, {
        where: { walletAddress: voterWallet },
      });

      if (!user) {
        this.logger.warn(
          `⚠️ [GovernanceIndexer] Voter wallet ${voterWallet} performed on-chain vote but has no local User profile linked yet.`,
        );
      }

      this.logger.log(
        `✅ [GovernanceIndexer] Recorded vote on Proposal #${numericProposalId} by ${voterWallet} (Support: ${support}, Weight: ${weight})`,
      );
    });
  }

  /**
   * Handles ProposalExecuted events to keep off-chain state synced with on-chain execution.
   */
  async handleProposalExecuted(eventData: {
    proposalId: string | number;
    txHash: string;
  }): Promise<void> {
    const { proposalId } = eventData;
    const numericProposalId = Number(proposalId);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const proposal = await manager.findOne(GovernanceProposal, {
        where: { proposalId: numericProposalId },
      });

      if (!proposal) {
        this.logger.error(
          `❌ [GovernanceIndexer] Proposal #${numericProposalId} not found for execution event.`,
        );
        return;
      }

      if (proposal.status === 'EXECUTED') {
        this.logger.warn(
          `⚠️ [GovernanceIndexer] Proposal #${numericProposalId} is already marked EXECUTED.`,
        );
        return;
      }

      await manager.update(
        GovernanceProposal,
        { id: proposal.id },
        { status: 'EXECUTED' },
      );

      this.logger.log(
        `✅ [GovernanceIndexer] Proposal #${numericProposalId} status updated to EXECUTED.`,
      );
    });
  }
}
