import { Module } from '@nestjs/common';
import { ListingModule } from './listing/listing.module';
import { TradeModule } from './trade/trade.module';
import { EscrowModule } from '../escrow/escrow.module'; // Added
import { AuditModule } from 'src/audit/audit.module';
@Module({
  imports: [
    AuditModule, // Must be imported to trigger @Global() registration
    EscrowModule, // Handles the safety vault for funds
    ListingModule, // Handles the storefront/sell orders
    TradeModule, // Handles the matching and execution logic
  ],
  exports: [AuditModule, EscrowModule, ListingModule, TradeModule],
})
export class SecondaryMarketModule {}
