// trade-lock.module.ts
import { Module } from '@nestjs/common';
import { TradeLockService } from './trade-lock.service';

@Module({
  providers: [TradeLockService],
  exports: [TradeLockService], // ✅ allow other modules to use it
})
export class TradeLockModule {}
