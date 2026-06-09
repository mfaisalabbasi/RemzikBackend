import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { InvestmentService } from './investment.service';
import { Logger } from '@nestjs/common';

@Processor('investment-queue')
export class InvestmentProcessor {
  private readonly logger = new Logger(InvestmentProcessor.name);

  constructor(private readonly investmentService: InvestmentService) {}

  @Process('process-investment')
  async handleInvestment(job: Job<{ investmentId: string }>) {
    const { investmentId } = job.data;
    this.logger.log(
      `[Queue] Starting tokenization for Investment: ${investmentId}`,
    );

    try {
      // 1. Execute blockchain transfer
      const txHash =
        await this.investmentService.executeBlockchainTransfer(investmentId);

      this.logger.log(
        `[Queue] Blockchain transfer successful. Hash: ${txHash}`,
      );

      // 2. Finalize status in DB
      await this.investmentService.finalizeTokenization(investmentId, txHash);

      this.logger.log(
        `[Queue] Investment ${investmentId} successfully finalized.`,
      );
    } catch (error: any) {
      this.logger.error(
        `[Queue] Failed to process investment ${investmentId}: ${error.message}`,
      );

      // 3. Rollback balance and update status to FAILED
      await this.investmentService.handleInvestmentFailure(
        investmentId,
        error.message,
      );

      throw error; // Let BullMQ handle retry logic
    }
  }
}
