import { Injectable } from '@nestjs/common';

@Injectable()
export class TradeLockService {
  private lockedTrades: Set<string> = new Set();

  lock(tradeId: string): boolean {
    if (this.lockedTrades.has(tradeId)) return false;
    this.lockedTrades.add(tradeId);
    return true;
  }

  unlock(tradeId: string) {
    this.lockedTrades.delete(tradeId);
  }
}
