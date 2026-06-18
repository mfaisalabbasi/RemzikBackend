import { Module, Global } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { IndexerService } from './indexer.service'; // 1. Import it
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChainEventLog } from './chain-event-log.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ChainEventLog])],
  providers: [BlockchainService, IndexerService], // 2. Add it here
  exports: [BlockchainService, IndexerService], // 3. Export it
})
export class BlockchainModule {}
