// src/recovery/recovery.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { RecoveryRequestEntity } from './recovery.entity';
import { User } from '../user/user.entity'; // Adjust path to your User entity
import { BlockchainModule } from '../blockchain/blockchain.module'; // Adjust path to Blockchain module
import { StorageModule } from '../storage/storage.module'; // Adjust path to Storage module
@Module({
  imports: [
    TypeOrmModule.forFeature([RecoveryRequestEntity, User]),
    BlockchainModule,
    StorageModule, // Ensure StorageModule is imported if used in RecoveryService
  ],
  controllers: [RecoveryController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
