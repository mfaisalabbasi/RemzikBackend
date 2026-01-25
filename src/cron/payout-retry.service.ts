import { Injectable } from '@nestjs/common';
import { PayoutService } from 'src/payout/payout.service';
import { UpdatePayoutStatusDto } from 'src/payout/dto/update-payout-status.dto';
import { PayoutStatus } from 'src/payout/enums/payout-status.enum';

@Injectable()
export class PayoutRetryService {
  constructor(private readonly payoutService: PayoutService) {}

  async retryPayout(payoutId: string) {
    // 1️⃣ Get the payout by ID
    const payout = await this.payoutService.getById(payoutId);

    // 2️⃣ Try to execute the payout (bank/crypto simulation)
    const success = await this.payoutService.executePayout(payout);

    // 3️⃣ Prepare DTO to update payout status
    const updateDto = new UpdatePayoutStatusDto();
    updateDto.status = success ? PayoutStatus.COMPLETED : PayoutStatus.FAILED;
    updateDto.reason = success ? 'Retry succeeded' : 'Retry failed';

    // 4️⃣ Update payout status in DB
    await this.payoutService.updatePayoutStatus(payout.id, updateDto);
  }
}
