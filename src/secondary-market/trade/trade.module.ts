import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// import { SecondaryMarketTrade } from './trade.entity';
import { SecondaryMarketListing } from '../listing/listing.entity';
import { TradeService } from './trade.service';
import { TradeController } from './trade.controller';
import { ListingModule } from '../listing/listing.module';
import { WalletModule } from '../../wallet/wallet.module';
import { OwnershipModule } from '../../ownership/ownership.module';
import { LedgerModule } from '../../ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SecondaryMarketListing]),
    ListingModule,
    WalletModule,
    OwnershipModule,
    LedgerModule,
  ],
  providers: [TradeService],
  controllers: [TradeController],
})
export class TradeModule {}
