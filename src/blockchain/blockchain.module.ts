import { Module, Global, forwardRef } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { IndexerService } from './indexer.service'; // 1. Import it
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChainEventLog } from './chain-event-log.entity';
import { GovernanceModule } from 'src/governance/governance.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([ChainEventLog]),
    forwardRef(() => GovernanceModule),
  ], // 1. Import GovernanceModule here
  providers: [BlockchainService, IndexerService], // 2. Add it here
  exports: [BlockchainService, IndexerService], // 3. Export it
})
export class BlockchainModule {}
