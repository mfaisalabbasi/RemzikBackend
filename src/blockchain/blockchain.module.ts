import { Module, Global } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';

@Global() // Makes this module available across the entire app without re-importing
@Module({
  providers: [BlockchainService],
  exports: [BlockchainService], // Exports the service so AdminService can use it
})
export class BlockchainModule {}
