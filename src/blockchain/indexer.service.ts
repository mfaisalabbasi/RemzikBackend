import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ChainEventLog } from './chain-event-log.entity';
import { BlockchainService } from './blockchain.service';
import { GovernanceService } from '../governance/governance.service'; // Added
import { Asset } from '../asset/asset.entity'; // Added
import { ethers, LogDescription } from 'ethers';
import * as PropertyGovernanceABI from './abi/PropertyGovernance.json'; // Ensure this ABI is available
import { AssetStatus } from '../asset/enums/asset-status.enum';
@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    @InjectRepository(ChainEventLog)
    private readonly logRepo: Repository<ChainEventLog>,
    private readonly blockchainService: BlockchainService,
    private readonly dataSource: DataSource,
    private readonly governanceService: GovernanceService, // Added
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
    const govInterface = new ethers.Interface(PropertyGovernanceABI.abi); // Added

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

          // Fetch active governance addresses to monitor
          const activeAssets = await this.dataSource.getRepository(Asset).find({
            where: { status: AssetStatus.APPROVED },
          }); // Assuming 1 is APPROVED
          const govAddresses = activeAssets
            .map((a) => a.governanceAddress)
            .filter(Boolean);

          const logs = await provider.getLogs({
            fromBlock,
            toBlock,
            address: [
              this.blockchainService.getRegistryAddress(),
              this.blockchainService.getFactoryAddress(),
              ...govAddresses,
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
                      factoryInterface.parseLog(log) ||
                      govInterface.parseLog(log);
                  } catch {}

                  // Handle Liquidation Event
                  if (parsed?.name === 'LiquidationActivated') {
                    const asset = await transactionalEntityManager
                      .getRepository(Asset)
                      .findOne({
                        where: { governanceAddress: log.address },
                      });
                    if (asset) {
                      await this.governanceService.triggerLiquidation(
                        asset.id,
                        log.address,
                      );
                      this.logger.log(
                        `Auto-liquidation triggered for asset: ${asset.id}`,
                      );
                    }
                  }

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
          }
        }
      } catch (err) {
        this.logger.error(`Sync loop error: ${(err as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 90000));
    }
  }
}
