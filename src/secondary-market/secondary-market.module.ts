import { Module } from '@nestjs/common';
import { ListingModule } from './listing/listing.module';
import { TradeModule } from './trade/trade.module';

@Module({
  imports: [ListingModule, TradeModule],
})
export class SecondaryMarketModule {}
