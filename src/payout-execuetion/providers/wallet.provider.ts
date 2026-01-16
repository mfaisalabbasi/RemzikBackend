import { Injectable } from '@nestjs/common';

@Injectable()
export class WalletProvider {
  async send(
    walletAddress: string,
    amount: number,
  ): Promise<{ txHash: string }> {
    // Later: stablecoin transfer
    return {
      txHash: `TX-${Date.now()}`,
    };
  }
}
