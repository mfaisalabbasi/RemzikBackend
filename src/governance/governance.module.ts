import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GovernanceService } from './governance.service';
import { GovernanceController } from './governance.controller';
import { GovernanceProposal } from './governance.entity';
import { BlockchainModule } from 'src/blockchain/blockchain.module';
import { AssetModule } from 'src/asset/asset.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([GovernanceProposal]),
    forwardRef(() => BlockchainModule),
    AssetModule, // Ensure AssetModule is imported here
  ],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
