import { Injectable, Logger } from '@nestjs/common';
import { Trade } from './trade.entity';
import { TradeStatus } from './enums/trade-status.enum';

/**
 * Data structure for an executed match between two orders
 */
export interface ExecutedTrade {
  buyerId: string;
  sellerId: string;
  assetId: string;
  units: number;
  pricePerUnit: number;
  executionTime: Date;
}

@Injectable()
export class MatchingEngineService {
  private readonly logger = new Logger(MatchingEngineService.name);

  /**
   * THE BRAIN OF THE EXCHANGE: Price-Time Priority Matching
   * This handles multiple assets at once and matches Buys vs Sells.
   * * @param buyOrders All PENDING buy orders from the database
   * @param sellOrders All PENDING sell orders from the database
   */
  match(buyOrders: Trade[], sellOrders: Trade[]): ExecutedTrade[] {
    const executedTrades: ExecutedTrade[] = [];

    // 1️⃣ Grouping: Find all unique assets that have active orders
    const assetIds = Array.from(
      new Set([...buyOrders, ...sellOrders].map((order) => order.asset.id)),
    );

    for (const assetId of assetIds) {
      // 2️⃣ Filtering: Get orders for THIS specific asset only
      const buysForAsset = buyOrders.filter(
        (b) =>
          b.asset.id === assetId &&
          b.status === TradeStatus.PENDING &&
          b.units > 0,
      );
      const sellsForAsset = sellOrders.filter(
        (s) =>
          s.asset.id === assetId &&
          s.status === TradeStatus.PENDING &&
          s.units > 0,
      );

      // 3️⃣ Sorting (Price-Time Priority):
      // Buys: Highest price first. If prices are equal, oldest (createdAt) first.
      buysForAsset.sort(
        (a, b) =>
          Number(b.pricePerUnit) - Number(a.pricePerUnit) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

      // Sells: Lowest price first. If prices are equal, oldest (createdAt) first.
      sellsForAsset.sort(
        (a, b) =>
          Number(a.pricePerUnit) - Number(b.pricePerUnit) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

      // 4️⃣ The Match Loop: Compare the "Best Buy" to the "Best Sell"
      for (const buy of buysForAsset) {
        if (buy.units <= 0) continue;

        for (const sell of sellsForAsset) {
          if (sell.units <= 0) continue;

          // Check if the Buyer is willing to pay the Seller's price (or more)
          if (Number(buy.pricePerUnit) >= Number(sell.pricePerUnit)) {
            // Determine how many units can be traded (Partial Fill logic)
            const unitsToTrade = Math.min(buy.units, sell.units);

            // Create the execution record
            executedTrades.push({
              buyerId: buy.buyer?.id || 'SYSTEM_RESERVED', // Buyer must exist for buy orders
              sellerId: sell.seller.id,
              assetId,
              units: unitsToTrade,
              pricePerUnit: Number(sell.pricePerUnit), // Execution happens at the Seller's price
              executionTime: new Date(),
            });

            // 5️⃣ Update state: Reduce units from the orders
            buy.units -= unitsToTrade;
            sell.units -= unitsToTrade;

            // If an order hits 0 units, mark it as COMPLETED
            if (buy.units === 0) buy.status = TradeStatus.COMPLETED;
            if (sell.units === 0) sell.status = TradeStatus.COMPLETED;

            this.logger.log(
              `MATCH SUCCESS: ${unitsToTrade} units of ${assetId} at SAR ${sell.pricePerUnit}`,
            );

            // If this buy order is fully satisfied, stop looking at more sellers
            if (buy.units === 0) break;
          }
        }
      }
    }

    return executedTrades;
  }
}
