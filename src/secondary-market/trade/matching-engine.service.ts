import { Injectable } from '@nestjs/common';
import { Trade } from './trade.entity';
import { TradeStatus } from './enums/trade-status.enum';
@Injectable()
export class MatchingEngineService {
  /**
   * Match buy and sell orders
   * Returns pairs of trades that can be executed
   */
  match(buyOrders: Trade[], sellOrders: Trade[]): [Trade, Trade][] {
    const matches: [Trade, Trade][] = [];

    // Filter only PENDING orders
    const pendingBuys = buyOrders.filter(
      (b) => b.status === TradeStatus.PENDING,
    );
    const pendingSells = sellOrders.filter(
      (s) => s.status === TradeStatus.PENDING,
    );

    // Sort: highest buy price first, lowest sell price first
    pendingBuys.sort((a, b) => b.pricePerUnit - a.pricePerUnit);
    pendingSells.sort((a, b) => a.pricePerUnit - b.pricePerUnit);

    for (const buy of pendingBuys) {
      for (const sell of pendingSells) {
        if (sell.status !== TradeStatus.PENDING) continue;

        // Match if buyer price >= seller price
        if (buy.pricePerUnit >= sell.pricePerUnit) {
          // Determine units to trade (partial fills supported)
          const unitsToTrade = Math.min(buy.units, sell.units);

          // Reduce units from orders
          buy.units -= unitsToTrade;
          sell.units -= unitsToTrade;

          // Mark trades as completed if fully filled
          if (buy.units === 0) buy.status = TradeStatus.COMPLETED;
          if (sell.units === 0) sell.status = TradeStatus.COMPLETED;

          // Clone trades for the match to represent the executed amount
          const executedBuy = { ...buy, units: unitsToTrade } as Trade;
          const executedSell = { ...sell, units: unitsToTrade } as Trade;

          matches.push([executedBuy, executedSell]);

          // Stop if buy is fully matched
          if (buy.units === 0) break;
        }
      }
    }

    return matches;
  }
}
