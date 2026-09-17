import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexerService } from './indexer.service';
import { IndexerRouter } from './indexer.router';
import { IdentityEventHandler } from './handlers/identity.handler';
import { AssetEventHandler } from './handlers/asset.handler';
import { InvestmentHandler } from './handlers/investment.handler';
import { GovernanceHandler } from './handlers/governance.handler';
import { MarketplaceHandler } from './handlers/marketplace.handler';
import { YieldHandler } from './handlers/yield.handler';
import { ChainEventLog } from '../chain-event-log.entity';
import { User } from '../../../src/user/user.entity';
import { Asset } from '../../asset/asset.entity';
import { AssetToken } from '../../tokenization/entities/asset-token.entity';
import { Investment } from '../../investment/investment.entity';
import { InvestorProfile } from '../../investor/investor.entity';
import { GovernanceProposal } from '../../governance/governance.entity';
import { Distribution } from '../../distribution/distribution.entity';
import { OwnershipModule } from '../../ownership/ownership.module';
import { BlockchainModule } from '../blockchain.module';
import { TradeModule } from '../../secondary-market/trade/trade.module'; // 👈 1. Import TradeModule to provide TradeService

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChainEventLog,
      User,
      Asset,
      AssetToken,
      Investment,
      InvestorProfile,
      GovernanceProposal,
      Distribution,
    ]),
    OwnershipModule,
    BlockchainModule,
    TradeModule, // 👈 2. Register TradeModule here so MarketplaceHandler can inject TradeService
  ],
  providers: [
    IndexerService,
    IndexerRouter,
    IdentityEventHandler,
    AssetEventHandler,
    InvestmentHandler,
    GovernanceHandler,
    MarketplaceHandler,
    YieldHandler,
  ],
  exports: [IndexerService],
})
export class IndexerModule {}
