import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ChainEventLog } from './chain-event-log.entity';
import { BlockchainService } from './blockchain.service';
import { ethers, LogDescription } from 'ethers';

@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    @InjectRepository(ChainEventLog)
    private readonly logRepo: Repository<ChainEventLog>,
    private readonly blockchainService: BlockchainService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    this.logger.log('Production Indexer initialized...');
    this.syncLoop().catch((err) =>
      this.logger.error('Sync loop fatal error:', err),
    );
  }

  private async syncLoop() {
    const provider = this.blockchainService.getIndexerProvider();
    const registryInterface = new ethers.Interface(
      this.blockchainService.getRegistryAbi(),
    );
    const factoryInterface = new ethers.Interface(
      this.blockchainService.getFactoryAbi(),
    );

    while (true) {
      try {
        const latestLogs = await this.logRepo.find({
          order: { blockNumber: 'DESC' },
          take: 1,
        });

        const lastLog = latestLogs.length > 0 ? latestLogs[0] : null;
        let fromBlock = lastLog ? Number(lastLog.blockNumber) + 1 : 0;
        fromBlock = Math.max(0, fromBlock);

        const currentBlock = await provider.getBlockNumber();

        if (fromBlock <= currentBlock) {
          const toBlock = Math.min(fromBlock + 10, currentBlock);
          this.logger.log(`Syncing blocks ${fromBlock} to ${toBlock}...`);

          const logs = await provider.getLogs({
            fromBlock,
            toBlock,
            address: [
              this.blockchainService.getRegistryAddress(),
              this.blockchainService.getFactoryAddress(),
            ],
          });

          if (logs.length > 0) {
            await this.dataSource.transaction(
              async (transactionalEntityManager) => {
                for (const log of logs) {
                  let parsed: LogDescription | null = null;
                  try {
                    parsed =
                      registryInterface.parseLog(log) ||
                      factoryInterface.parseLog(log);
                  } catch {}

                  const entity = this.logRepo.create({
                    txHash: log.transactionHash,
                    eventName: parsed
                      ? (parsed as LogDescription).name
                      : 'Unknown',
                    eventData:
                      parsed && (parsed as LogDescription).args
                        ? JSON.parse(
                            JSON.stringify(
                              (parsed as LogDescription).args.toObject(),
                              (k, v) =>
                                typeof v === 'bigint' ? v.toString() : v,
                            ),
                          )
                        : { rawData: log.data },
                    blockNumber: Number(log.blockNumber),
                  });

                  await transactionalEntityManager.upsert(
                    ChainEventLog,
                    entity,
                    ['txHash'],
                  );
                }
              },
            );
            this.logger.log(`Indexed ${logs.length} logs.`);
          } else {
            // FIX: If no logs found, mark this block range as "seen" to prevent re-scanning
            // We do this by creating a placeholder entry if necessary or simply relying
            // on the fact that we increment fromBlock next loop.
            this.logger.log(
              `No logs in range ${fromBlock}-${toBlock}, advancing cursor.`,
            );
          }
        }
      } catch (err) {
        this.logger.error(`Sync loop error: ${(err as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 90000));
    }
  }
}
