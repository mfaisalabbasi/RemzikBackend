import { Injectable } from '@nestjs/common';
import { Trade } from './trade.entity';

@Injectable()
export class MatchingEngineService {
  match(buyOrders: Trade[], sellOrders: Trade[]): [Trade, Trade][] {
    const matches: [Trade, Trade][] = [];

    buyOrders.forEach((buy) => {
      const sell = sellOrders.find(
        (s) => s.price <= buy.price && s.status === 'PENDING',
      );
      if (sell) {
        matches.push([buy, sell]);
      }
    });

    return matches;
  }
}
