import { Injectable } from '@nestjs/common';
import { Trade } from './trade.entity';
import { TradeStatus } from './enums/trade-status.enum';

export interface ExecutedTrade {
  buyerId: string;
  sellerId: string;
  assetId: string;
  units: number;
  pricePerUnit: number;
}

@Injectable()
export class MatchingEngineService {
  /**
   * Match buy and sell orders
   * Supports multi-asset, partial fills, and price-time priority
   * Returns array of executed trade objects
   */
  match(buyOrders: Trade[], sellOrders: Trade[]): ExecutedTrade[] {
    const executedTrades: ExecutedTrade[] = [];

    // 1️⃣ Filter only PENDING orders
    const pendingBuys = buyOrders.filter(
      (b) => b.status === TradeStatus.PENDING,
    );
    const pendingSells = sellOrders.filter(
      (s) => s.status === TradeStatus.PENDING,
    );

    // 2️⃣ Group orders by asset for multi-asset support
    const assets = Array.from(
      new Set([...pendingBuys, ...pendingSells].map((o) => o.asset.id)),
    );

    for (const assetId of assets) {
      const buys = pendingBuys.filter((b) => b.asset.id === assetId);
      const sells = pendingSells.filter((s) => s.asset.id === assetId);

      // 3️⃣ Sort orders by price-time priority
      buys.sort(
        (a, b) =>
          b.pricePerUnit - a.pricePerUnit ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      sells.sort(
        (a, b) =>
          a.pricePerUnit - b.pricePerUnit ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

      // 4️⃣ Match loop
      for (const buy of buys) {
        if (buy.units <= 0) continue;

        for (const sell of sells) {
          if (sell.units <= 0) continue;

          // Check price condition
          if (buy.pricePerUnit >= sell.pricePerUnit) {
            // Determine units to trade (partial fill)
            const unitsToTrade = Math.min(buy.units, sell.units);

            // Reduce units from both orders
            buy.units -= unitsToTrade;
            sell.units -= unitsToTrade;

            // Mark as completed if fully filled
            if (buy.units === 0) buy.status = TradeStatus.COMPLETED;
            if (sell.units === 0) sell.status = TradeStatus.COMPLETED;

            // Add executed trade
            executedTrades.push({
              buyerId: buy.buyer?.id || buy.seller.id, // buyerProfile.id must be provided when creating buy order
              sellerId: sell.seller.id,
              assetId,
              units: unitsToTrade,
              pricePerUnit: sell.pricePerUnit, // seller price is executed price
            });

            // Stop if buy is fully matched
            if (buy.units === 0) break;
          }
        }
      }
    }

    return executedTrades;
  }
}
