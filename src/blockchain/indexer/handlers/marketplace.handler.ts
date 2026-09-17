import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SecondaryMarketListing } from '../../../secondary-market/listing/listing.entity';
import { ListingStatus } from '../../../secondary-market/listing/enums/listing-status.enum';
import { TradeService } from '../../../secondary-market/trade/trade.service';
import { OwnershipService } from '../../../ownership/ownership.service';
import { BlockchainService } from '../../../blockchain/blockchain.service';

@Injectable()
export class MarketplaceHandler {
  private readonly logger = new Logger(MarketplaceHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tradeService: TradeService,
    private readonly ownershipService: OwnershipService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async handleListingCreated(
    listingId: string,
    seller: string,
    token: string,
    amount: bigint,
    txHash: string,
  ) {
    this.logger.log(
      `📥 [Index] ListingCreated: ID=${listingId}, Seller=${seller}, Token=${token}, Amount=${amount.toString()}, Tx: ${txHash}`,
    );

    const listingRepo = this.dataSource.getRepository(SecondaryMarketListing);
    let listing = await listingRepo.findOne({ where: { id: listingId } });

    if (!listing) {
      this.logger.warn(
        `⚠️ Listing ${listingId} detected on-chain but not found in off-chain database.`,
      );
      return;
    }

    listing.status = ListingStatus.ACTIVE;
    listing.blockchainStatus = 'CONFIRMED';
    listing.txHash = txHash;

    await listingRepo.save(listing);
    this.logger.log(
      `✅ Listing ${listingId} successfully confirmed and active via indexer.`,
    );
  }

  async handleListingCancelled(listingId: string, txHash: string) {
    this.logger.log(
      `🚫 [Index] ListingCancelled: ID=${listingId}, Tx: ${txHash}`,
    );

    const listingRepo = this.dataSource.getRepository(SecondaryMarketListing);
    const listing = await listingRepo.findOne({ where: { id: listingId } });

    if (listing) {
      await listingRepo.delete({ id: listingId });
      this.logger.log(
        `✅ Listing ${listingId} successfully removed from DB via indexer cancellation.`,
      );
    } else {
      this.logger.warn(
        `⚠️ Listing ${listingId} not found in DB during indexer cancellation event.`,
      );
    }
  }

  async handleTradeExecuted(
    listingId: string,
    seller: string,
    buyer: string,
    price: bigint,
    txHash: string,
  ) {
    this.logger.log(
      `🤝 [Index] TradeExecuted: ID=${listingId}, Seller=${seller}, Buyer=${buyer}, Price=${price.toString()}, Tx: ${txHash}`,
    );

    try {
      const buyerProfile =
        await this.ownershipService.getInvestorByUserId(buyer);
      await this.tradeService.syncOnChainTrade(listingId, buyerProfile, txHash);

      this.logger.log(
        `✅ Off-chain escrow/trade settled & synchronized via indexer for listing ${listingId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to sync TradeExecuted for listing ${listingId}: ${error.message}`,
      );
      throw error;
    }
  }

  async handleOnChainTradeExecuted(
    listingId: string,
    buyer: string,
    unitsBought: bigint,
    totalCost: bigint,
    txHash: string,
  ) {
    this.logger.log(
      `⚡ [Index] OnChainTradeExecuted: ID=${listingId}, Buyer=${buyer}, Units=${unitsBought.toString()}, Cost=${totalCost.toString()}, Tx: ${txHash}`,
    );

    try {
      const buyerProfile =
        await this.ownershipService.getInvestorByUserId(buyer);
      await this.tradeService.syncOnChainTrade(listingId, buyerProfile, txHash);

      this.logger.log(
        `✅ On-chain trade fulfillment successfully synchronized via indexer for listing ${listingId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to sync OnChainTradeExecuted for listing ${listingId}: ${error.message}`,
      );
      throw error;
    }
  }
}
