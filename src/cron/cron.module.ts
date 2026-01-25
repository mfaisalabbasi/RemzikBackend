import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { PayoutRetryService } from './payout-retry.service';
import { PayoutModule } from '../payout/payout.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PayoutModule, WalletModule],
  providers: [CronService, PayoutRetryService],
})
export class CronModule {}
