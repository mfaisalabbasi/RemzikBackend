import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './trade.entity';
import { SecondaryMarketListing } from '../listing/listing.entity';
import { TradeService } from './trade.service';
import { TradeController } from './trade.controller';
import { ListingModule } from '../listing/listing.module';
import { WalletModule } from '../../wallet/wallet.module';
import { OwnershipModule } from '../../ownership/ownership.module';
import { LedgerModule } from '../../ledger/ledger.module';
import { TradeLockModule } from './trade-lock.module';
import { User } from 'src/user/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Trade,
      SecondaryMarketListing,
      User, // ✅ Entities must go inside forFeature
    ]),
    ListingModule,
    WalletModule,
    OwnershipModule,
    LedgerModule,
    TradeLockModule,
  ],
  providers: [TradeService],
  controllers: [TradeController],
})
export class TradeModule {}
