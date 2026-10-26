import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GovernanceProposal } from './governance.entity';
import { Asset } from '../asset/asset.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers } from 'ethers';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class GovernanceService {
  private readonly logger = new Logger(GovernanceService.name);

  constructor(
    @InjectRepository(GovernanceProposal)
    private proposalRepo: Repository<GovernanceProposal>,

    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,

    private blockchainService: BlockchainService,
    private notificationOrchestrator: NotificationOrchestrator,
  ) {}

  /**
   * Submit proposal to the blockchain
   * 2. Parse the on-chain proposalId from logs
   * 3. Save proposal record with proposalId in the database
   */
  async proposeAction(assetId: string, description: string, duration: number) {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['partner', 'partner.user'],
    });

    if (!asset || !asset.governanceAddress) {
      throw new Error('Asset governance contract not found.');
    }

    try {
      // 1. Submit to blockchain
      const tx = await this.blockchainService.createProposalOnChain(
        asset.governanceAddress,
        description,
        duration,
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        throw new Error('On-chain proposal transaction failed.');
      }

      // 2. Parse the ProposalCreated event from logs to extract proposalId
      let onChainProposalId: number | undefined = undefined;

      const govContractInterface = new ethers.Interface([
        'event ProposalCreated(uint256 indexed proposalId, string description, uint256 deadline)',
      ]);

      for (const log of receipt.logs) {
        try {
          const parsed = govContractInterface.parseLog(log as any);

          if (parsed?.name === 'ProposalCreated') {
            onChainProposalId = Number(parsed.args.proposalId);

            break;
          }
        } catch (e) {}
      }

      // Fallback: Read current proposal count directly from contract if event wasn't matched
      if (onChainProposalId === undefined) {
        const govContract = new ethers.Contract(
          asset.governanceAddress,
          ['function proposalCount() view returns (uint256)'],
          this.blockchainService.getProvider(),
        );

        onChainProposalId = Number(await govContract.proposalCount());
      }

      // 3. Save to database with the required proposalId
      const savedProposal = await this.proposalRepo.save({
        proposalId: onChainProposalId,
        asset: { id: assetId },
        description,
        status: 'PENDING',
        txHash: tx.hash,
      });

      // 🛡️ NOTIFICATION: Inform partner/stakeholders of new proposal
      try {
        const partnerUserId = asset.partner?.user?.id;
        if (partnerUserId) {
          await this.notificationOrchestrator.buildAndSave(
            partnerUserId,
            'governance.proposal_created',
            {
              title: 'Governance Proposal Created',
              message: `A new proposal has been submitted for asset "${asset.title}".`,
              proposalId: onChainProposalId,
              assetId,
              timestamp: new Date(),
            },
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to send proposal creation notification: ${err}`,
        );
      }

      return savedProposal;
    } catch (error: any) {
      this.logger.error(
        `Proposal creation failed for asset ${assetId}: ${error.message}`,
      );

      throw error;
    }
  }

  /**
   * Finalizes an existing proposal on the blockchain.
   */
  async executeProposal(assetId: string, proposalId: number) {
    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['partner', 'partner.user'],
    });

    if (!asset || !asset.governanceAddress) throw new Error('Asset not found.');

    try {
      await this.blockchainService.executeProposalOnChain(
        asset.governanceAddress,
        proposalId,
      );

      await this.proposalRepo.update(
        { asset: { id: assetId }, proposalId },
        { status: 'EXECUTED' },
      );

      // 🛡️ NOTIFICATION: Inform partner of proposal execution
      try {
        const partnerUserId = asset.partner?.user?.id;
        if (partnerUserId) {
          await this.notificationOrchestrator.buildAndSave(
            partnerUserId,
            'governance.proposal_executed',
            {
              title: 'Governance Proposal Executed',
              message: `Proposal #${proposalId} for asset "${asset.title}" has been successfully executed.`,
              proposalId,
              assetId,
              timestamp: new Date(),
            },
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to send proposal execution notification: ${err}`,
        );
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(
        `Execution failed for asset ${assetId}: ${error.message}`,
      );

      throw error;
    }
  }

  /**
   * Triggers the liquidation kill-switch on-chain with robust pause-state guards.
   */
  async triggerLiquidation(assetId: string, governanceAddress: string) {
    if (!assetId || !governanceAddress) {
      throw new Error('Missing assetId or governanceAddress.');
    }

    const asset = await this.assetRepo.findOne({
      where: { id: assetId },
      relations: ['partner', 'partner.user'],
    });

    try {
      // On-chain call
      await this.blockchainService.triggerLiquidationOnChain(governanceAddress);

      // Update proposal/governance status
      await this.proposalRepo.update(
        { asset: { id: assetId } },
        { status: 'LIQUIDATED' },
      );

      // Update main Asset status to prevent sync loops
      await this.assetRepo.update({ id: assetId }, {
        status: 'LIQUIDATED',
      } as any);

      // 🛡️ NOTIFICATION: Inform partner of asset liquidation
      try {
        const partnerUserId = asset?.partner?.user?.id;
        if (partnerUserId) {
          await this.notificationOrchestrator.buildAndSave(
            partnerUserId,
            'governance.liquidated',
            {
              title: 'Asset Liquidated',
              message: `The liquidation kill-switch has been triggered for asset "${asset?.title || assetId}".`,
              assetId,
              timestamp: new Date(),
            },
          );
        }
      } catch (err) {
        this.logger.error(`Failed to send liquidation notification: ${err}`);
      }

      return { success: true };
    } catch (error: any) {
      if (
        error.message?.includes('EnforcedPause') ||
        error.message?.includes('0xd93c0665') ||
        error.data === '0xd93c0665'
      ) {
        this.logger.warn(
          `⚠️ Asset ${assetId} is already paused/liquidated on-chain. Syncing local database state...`,
        );

        await this.proposalRepo.update(
          { asset: { id: assetId } },
          { status: 'LIQUIDATED' },
        );
        await this.assetRepo.update({ id: assetId }, {
          status: 'LIQUIDATED',
        } as any);

        return {
          success: true,
          message: 'Already liquidated on-chain; state synced.',
        };
      }

      this.logger.error(
        `Liquidation failed for asset ${assetId}: ${error.message}`,
      );

      throw error;
    }
  }
}
