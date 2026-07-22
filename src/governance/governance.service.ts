import { Injectable, Logger } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { GovernanceProposal } from './governance.entity';

import { Asset } from '../asset/asset.entity';

import { BlockchainService } from '../blockchain/blockchain.service';

import { ethers } from 'ethers';

@Injectable()
export class GovernanceService {
  private readonly logger = new Logger(GovernanceService.name);

  constructor(
    @InjectRepository(GovernanceProposal)
    private proposalRepo: Repository<GovernanceProposal>,

    @InjectRepository(Asset)
    private assetRepo: Repository<Asset>,

    private blockchainService: BlockchainService,
  ) {}

  /**

* 1. Submit proposal to the blockchain

* 2. Parse the on-chain proposalId from logs

* 3. Save proposal record with proposalId in the database

*/

  async proposeAction(assetId: string, description: string, duration: number) {
    const asset = await this.assetRepo.findOneBy({ id: assetId });

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

      return await this.proposalRepo.save({
        proposalId: onChainProposalId,

        asset: { id: assetId },

        description,

        status: 'PENDING',

        txHash: tx.hash,
      });
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
    const asset = await this.assetRepo.findOneBy({ id: assetId });

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

      return { success: true };
    } catch (error: any) {
      this.logger.error(
        `Execution failed for asset ${assetId}: ${error.message}`,
      );

      throw error;
    }
  }

  /**

* Triggers the liquidation kill-switch on-chain.

*/

  async triggerLiquidation(assetId: string, governanceAddress: string) {
    if (!assetId || !governanceAddress) {
      throw new Error('Missing assetId or governanceAddress.');
    }

    try {
      // On-chain call

      await this.blockchainService.triggerLiquidationOnChain(governanceAddress);

      // Update DB

      await this.proposalRepo.update(
        { asset: { id: assetId } },

        { status: 'LIQUIDATED' },
      );

      return { success: true };
    } catch (error: any) {
      this.logger.error(
        `Liquidation failed for asset ${assetId}: ${error.message}`,
      );

      throw error;
    }
  }
}
