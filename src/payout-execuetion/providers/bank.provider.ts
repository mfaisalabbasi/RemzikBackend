import { Injectable } from '@nestjs/common';

@Injectable()
export class BankProvider {
  async send(iban: string, amount: number): Promise<{ reference: string }> {
    // Later: STC Pay, Stripe, local banks
    return {
      reference: `BANK-${Date.now()}`,
    };
  }
}
