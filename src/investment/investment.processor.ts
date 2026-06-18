import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { InvestmentService } from './investment.service';
import { Logger } from '@nestjs/common';
import { InvestmentStatus } from './enums/investment-status.enum';

@Processor('investment-queue')
export class InvestmentProcessor {
  private readonly logger = new Logger(InvestmentProcessor.name);

  constructor(private readonly investmentService: InvestmentService) {}

  @Process('process-investment')
  async handleInvestment(job: Job<{ investmentId: string }>) {
    const { investmentId } = job.data;

    try {
      // ATOMICITY CHECK: Ensure we aren't re-processing a completed job
      const investment = await this.investmentService.getById(investmentId);
      if (investment?.status === InvestmentStatus.CONFIRMED) {
        this.logger.warn(
          `Investment ${investmentId} already confirmed. Skipping.`,
        );
        return;
      }

      // Execute transfer
      const txHash =
        await this.investmentService.executeBlockchainTransfer(investmentId);

      // Finalize
      await this.investmentService.finalizeTokenization(investmentId, txHash);

      this.logger.log(`[Queue] Successfully finalized ${investmentId}`);
    } catch (error: any) {
      this.logger.error(
        `[Queue] Failed processing ${investmentId}: ${error.message}`,
      );
      await this.investmentService.handleInvestmentFailure(
        investmentId,
        error.message,
      );
      throw error; // Let BullMQ retry
    }
  }
}
