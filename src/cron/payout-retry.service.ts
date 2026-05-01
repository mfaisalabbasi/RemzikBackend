import { Injectable } from '@nestjs/common';
import { WithdrawalService } from 'src/finance/withdrawal/withdrawal.service';
import { WithdrawalStatus } from 'src/finance/withdrawal/withdrawal.entity';

@Injectable()
export class PayoutRetryService {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  async retryPayout(payoutId: string) {
    // 1️⃣ Get the withdrawal record by ID
    const withdrawal = await this.withdrawalService.getById(payoutId);

    // 2️⃣ Try to execute the payout (The Bridge to your Banking API)
    const success = await this.withdrawalService.executePayout(withdrawal);

    // 3️⃣ Determine the new status based on success
    // No 'new' keyword needed; we use the Enum values directly
    const finalStatus = success
      ? WithdrawalStatus.COMPLETED
      : WithdrawalStatus.FAILED;

    // 4️⃣ Update the status in the DB
    // We pass the ID and the raw Enum value
    await this.withdrawalService.updatePayoutStatus(withdrawal.id, finalStatus);

    // Optional: Log the result for Faisal's admin audit trail
    console.log(`Retry for ${payoutId}: ${success ? 'SUCCESS' : 'FAILED'}`);
  }
}
