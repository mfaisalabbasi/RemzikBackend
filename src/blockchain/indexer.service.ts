import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChainEventLog } from './chain-event-log.entity';
import { BlockchainService } from './blockchain.service';
import { ethers, LogDescription } from 'ethers';
import * as AssetTokenABI from './abi/RemzikAssetToken.json';

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);
  private tokenInterface: ethers.Interface;

  constructor(
    @InjectRepository(ChainEventLog)
    private readonly logRepo: Repository<ChainEventLog>,
    private readonly blockchainService: BlockchainService,
  ) {
    this.tokenInterface = new ethers.Interface(
      (AssetTokenABI as any).abi || AssetTokenABI,
    );
  }

  async onModuleInit() {
    this.logger.log('Production Indexer initialized...');
    this.syncLoop().catch((err) =>
      this.logger.error('Sync loop fatal error:', err),
    );
  }

  /**
   * Helper to safely serialize BigInt for database storage
   */
  private serializeEventData(data: any): any {
    return JSON.parse(
      JSON.stringify(data, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }

  private async syncLoop() {
    const provider = this.blockchainService.getProvider();
    const registryInterface = new ethers.Interface(
      this.blockchainService.getRegistryAbi(),
    );
    const factoryInterface = new ethers.Interface(
      this.blockchainService.getFactoryAbi(),
    );

    while (true) {
      try {
        // 1. Fetch all previously deployed tokens to monitor their events dynamically
        const deployedTokens = await this.logRepo.find({
          where: { eventName: 'AssetTokenDeployed' },
        });
        const tokenAddresses = deployedTokens.map(
          (t) => t.eventData.tokenAddress,
        );

        // 2. Combine all addresses to watch
        const addressesToWatch = [
          this.blockchainService.getRegistryAddress(),
          this.blockchainService.getFactoryAddress(),
          ...tokenAddresses,
        ];

        const lastLog = await this.logRepo.findOne({
          where: {},
          order: { blockNumber: 'DESC' },
        });
        let fromBlock = lastLog ? Number(lastLog.blockNumber) + 1 : 0;
        const currentBlock = await provider.getBlockNumber();

        if (fromBlock <= currentBlock) {
          this.logger.log(`Scanning blocks ${fromBlock} to ${currentBlock}...`);

          const logs = await provider.getLogs({
            fromBlock,
            toBlock: currentBlock,
            address: addressesToWatch,
          });

          for (const log of logs) {
            let parsed: LogDescription | null = null;

            try {
              // Try parsing against all known interfaces
              parsed =
                registryInterface.parseLog(log) ||
                factoryInterface.parseLog(log) ||
                this.tokenInterface.parseLog(log);
            } catch (e) {
              // Silently ignore logs that don't match our ABIs
            }

            // Upsert ensures we don't duplicate logs and handles BigInt serialization
            await this.logRepo.upsert(
              {
                txHash: log.transactionHash,
                eventName: parsed ? parsed.name : 'Unknown',
                eventData: parsed
                  ? this.serializeEventData(parsed.args.toObject())
                  : { rawData: log.data },
                blockNumber: Number(log.blockNumber),
              },
              ['txHash'],
            );

            if (parsed) {
              this.logger.log(
                `Indexed: ${parsed.name} | Source: ${log.address.slice(0, 8)}...`,
              );
            }
          }
        }
      } catch (err) {
        this.logger.error(`Sync loop error: ${(err as Error).message}`);
      }
      // Wait 10 seconds before next poll
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}
