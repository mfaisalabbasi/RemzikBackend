import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IndexerRouter } from './indexer.router';
import { ChainEventLog } from '../chain-event-log.entity';
import { BlockchainService } from '../blockchain.service';
import { Asset } from '../../asset/asset.entity';
import { ethers } from 'ethers';

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);
  private isRunning = false;
  private provider: ethers.JsonRpcProvider;

  // 🛡️ Safe block chunk size to prevent RPC "range too large" errors on public nodes
  private readonly MAX_BLOCK_RANGE = 2000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly indexerRouter: IndexerRouter,
    private readonly blockchainService: BlockchainService,
  ) {
    this.provider = this.blockchainService.getProvider();
  }

  async onModuleInit() {
    this.startListening();
  }

  private async startListening() {
    this.isRunning = true;
    this.logger.log('🚀 Remzik Background Indexer Service Started.');

    while (this.isRunning) {
      try {
        await this.pollNewBlocks();
      } catch (error: any) {
        this.logger.error(
          `Error in indexer polling loop: ${error.message}`,
          error.stack,
        );
      }
      // Poll interval (checks for new blocks every 6 seconds)
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
  }

  private async pollNewBlocks() {
    const latestBlock = await this.provider.getBlockNumber();

    const eventRepo = this.dataSource.getRepository(ChainEventLog);

    const lastLogs = await eventRepo.find({
      order: { blockNumber: 'DESC' },
      take: 1,
    });
    const lastLog = lastLogs.length > 0 ? lastLogs[0] : null;

    // 🛡️ Ensure startBlock is never negative or invalid
    let calculatedStart = lastLog
      ? Number(lastLog.blockNumber) + 1
      : Number(process.env.START_BLOCK || latestBlock - 50);

    const startBlock = Math.max(
      0,
      isNaN(calculatedStart) ? 0 : calculatedStart,
    );

    if (startBlock > latestBlock) {
      return; // Fully up to date with the chain
    }

    // Prevent massive batch queries by capping `toBlock` based on MAX_BLOCK_RANGE
    const toBlock = Math.min(latestBlock, startBlock + this.MAX_BLOCK_RANGE);

    // 🛡️ Track core system contracts and active assets dynamically
    const registryAddress = this.blockchainService.getRegistryAddress();
    const factoryAddress = this.blockchainService.getFactoryAddress();
    const marketplaceAddress = this.blockchainService.getMarketplaceAddress?.();
    const yieldNotaryAddress = process.env.YIELD_NOTARY_ADDRESS;

    const assetRepo = this.dataSource.getRepository(Asset);
    const activeAssets = await assetRepo.find({
      select: ['tokenAddress', 'treasuryAddress', 'governanceAddress'],
    });

    // Build a lookup dictionary for human-readable contract labels
    const contractLabels: Record<string, string> = {};
    if (registryAddress)
      contractLabels[registryAddress.toLowerCase()] = 'IdentityRegistry';
    if (factoryAddress)
      contractLabels[factoryAddress.toLowerCase()] = 'AssetFactory';
    if (marketplaceAddress)
      contractLabels[marketplaceAddress.toLowerCase()] = 'Marketplace';
    if (yieldNotaryAddress)
      contractLabels[yieldNotaryAddress.toLowerCase()] = 'YieldNotary';

    activeAssets.forEach((a) => {
      if (a.tokenAddress)
        contractLabels[a.tokenAddress.toLowerCase()] = 'AssetToken';
      if (a.treasuryAddress)
        contractLabels[a.treasuryAddress.toLowerCase()] = 'TreasuryVault';
      if (a.governanceAddress)
        contractLabels[a.governanceAddress.toLowerCase()] =
          'PropertyGovernance';
    });

    // Fetch all logs universally within the chunked block range so nothing gets bypassed
    const logs = await this.provider.getLogs({
      fromBlock: startBlock,
      toBlock: toBlock,
    });

    for (const log of logs) {
      // 🛡️ Optimized Idempotency Check using first-class columns (`txHash` + `logIndex`)
      const alreadyProcessed = await eventRepo.findOne({
        where: {
          txHash: log.transactionHash,
          logIndex: log.index,
        },
      });
      if (alreadyProcessed) continue;

      // Route event to handler and capture the dynamic event name string returned from router
      const routedEventName: string = await this.indexerRouter.routeEvent(
        log.address,
        [...log.topics],
        log.data,
        log.transactionHash,
        log.blockNumber,
      );

      console.log(
        `Processing log------------: ${routedEventName} from ${log.address} at block ${log.blockNumber}`,
      );

      // Resolve exact contract name or gracefully default
      const matchedContractName =
        contractLabels[log.address.toLowerCase()] || 'SmartContract';

      // Save processed log checkpoint with first-class `logIndex` column and clean event metadata
      await eventRepo.save({
        txHash: log.transactionHash,
        eventName: routedEventName,
        contractName: matchedContractName,
        blockNumber: log.blockNumber,
        logIndex: log.index, // 👈 Saved directly as a first-class column
        eventData: {
          contractName: matchedContractName,
          topics: log.topics,
          data: log.data,
          address: log.address,
        },
      });
    }

    // If there are still blocks left to catch up, log progress or loop immediately
    if (toBlock < latestBlock) {
      this.logger.log(
        `🔄 Catching up blocks: processed up to ${toBlock}/${latestBlock}`,
      );
    }
  }
}
