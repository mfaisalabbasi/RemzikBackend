import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { PayoutRetryService } from './payout-retry.service';

import { WalletModule } from '../wallet/wallet.module';
import { FinanceModule } from 'src/finance/finance.module';

@Module({
  imports: [WalletModule, FinanceModule],
  providers: [CronService, PayoutRetryService],
})
export class CronModule {}
