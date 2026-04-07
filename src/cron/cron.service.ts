import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from '../payout/payout.service';
import { PayoutStatus } from '../payout/enums/payout-status.enum';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  constructor(private readonly payoutService: PayoutService) {}

  @Cron(CronExpression.EVERY_HOUR) // Process withdrawals every hour
  async autoProcessWithdrawals() {
    const pending = await this.payoutService.getPendingRequests();

    for (const req of pending) {
      try {
        // 1. Integration: Here you would call an API like Stripe, PayPal, or a local Saudi Bank API
        const isBankTransferSuccess = await this.simulateBankApi(req);

        if (isBankTransferSuccess) {
          await this.payoutService.finalizePayout(req.id, {
            status: PayoutStatus.COMPLETED,
          });
        } else {
          await this.payoutService.finalizePayout(req.id, {
            status: PayoutStatus.FAILED,
            reason: 'Bank rejected transfer',
          });
        }
      } catch (err) {
        this.logger.error(`Failed to process payout ${req.id}: ${err.message}`);
      }
    }
  }

  private async simulateBankApi(payout: any): Promise<boolean> {
    // In the future, replace this with your real bank gateway
    return true;
  }
}
