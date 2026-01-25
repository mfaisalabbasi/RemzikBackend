import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from '../payout/payout.service';
import { UpdatePayoutStatusDto } from '../payout/dto/update-payout-status.dto';
import { PayoutStatus } from '../payout/enums/payout-status.enum';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private readonly payoutService: PayoutService) {}

  // Run every minute for testing
  @Cron(CronExpression.EVERY_MINUTE)
  async processPayouts() {
    const payouts = await this.payoutService.getPendingPayouts();

    for (const payout of payouts) {
      // Mark as processing
      const processingDto = new UpdatePayoutStatusDto();
      processingDto.status = PayoutStatus.PROCESSING;
      await this.payoutService.updatePayoutStatus(payout.id, processingDto);

      // Execute payout
      const success = await this.payoutService.executePayout(payout);

      // Update status accordingly
      const updateDto = new UpdatePayoutStatusDto();
      updateDto.status = success ? PayoutStatus.COMPLETED : PayoutStatus.FAILED;
      updateDto.reason = success ? 'Payout processed' : 'Payout failed';
      await this.payoutService.updatePayoutStatus(payout.id, updateDto);
    }

    this.logger.log(`Processed ${payouts.length} payouts`);
  }
}
