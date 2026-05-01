import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WithdrawalService } from 'src/finance/withdrawal/withdrawal.service';
import { WithdrawalStatus } from 'src/finance/withdrawal/withdrawal.entity';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Cron(CronExpression.EVERY_HOUR) // Process withdrawals every hour
  async autoProcessWithdrawals() {
    const pending = await this.withdrawalService.getPendingRequests();

    for (const req of pending) {
      try {
        // 1. Integration: Future hook for Saudi Bank API / SARIE
        const isBankTransferSuccess = await this.simulateBankApi(req);

        if (isBankTransferSuccess) {
          await this.withdrawalService.finalizePayout(req.id, {
            status: WithdrawalStatus.COMPLETED,
          });
        } else {
          await this.withdrawalService.finalizePayout(req.id, {
            status: WithdrawalStatus.FAILED,
            reason: 'Bank rejected transfer',
          });
        }
      } catch (err: unknown) {
        // 🚀 TYPE SAFE ERROR HANDLING:
        // Narrow 'unknown' to 'Error' to safely access .message
        const errorMessage = err instanceof Error ? err.message : String(err);

        this.logger.error(
          `Failed to process payout ${req.id}: ${errorMessage}`,
        );
      }
    }
  }

  private async simulateBankApi(payout: any): Promise<boolean> {
    // Logic for real-world bank gateway integration
    return true;
  }
}
