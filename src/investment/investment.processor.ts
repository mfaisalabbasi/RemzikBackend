// src/investment/investment.processor.ts

import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';

import { InvestmentService } from './investment.service';
import { InvestmentStatus } from './enums/investment-status.enum';

@Processor('investment-queue')
export class InvestmentProcessor {
  private readonly logger = new Logger(InvestmentProcessor.name);

  constructor(private readonly investmentService: InvestmentService) {}

  @Process('process-investment')
  async handleInvestment(job: Job<{ investmentId: string }>): Promise<void> {
    const { investmentId } = job.data;

    this.logger.log(
      `[Queue] Processing Hybrid investment ${investmentId} (Money Off-Chain, Ownership On-Chain)`,
    );

    try {
      /**
       * --------------------------------------------------------
       * 1. Load investment
       * --------------------------------------------------------
       */
      const investment = await this.investmentService.getById(investmentId);

      if (!investment) {
        throw new Error(`Investment ${investmentId} not found.`);
      }

      /**
       * --------------------------------------------------------
       * 2. Idempotency
       * --------------------------------------------------------
       * Bull can retry a job. Never execute an already
       * completed investment again. This stops the terminal loop.
       */
      if (investment.status === InvestmentStatus.CONFIRMED) {
        this.logger.warn(
          `[Queue] Investment ${investmentId} already confirmed. Skipping.`,
        );

        return;
      }

      if (investment.status === InvestmentStatus.FAILED) {
        this.logger.warn(
          `[Queue] Investment ${investmentId} is already FAILED. Skipping.`,
        );

        return;
      }

      /**
       * --------------------------------------------------------
       * 3. On-Chain Ownership Transfer Execution
       * --------------------------------------------------------
       * Money is handled off-chain, but token ownership
       * and tokenization minting happen on-chain.
       */
      const txHash =
        await this.investmentService.executeBlockchainTransfer(investmentId);

      if (!txHash) {
        throw new Error(
          `Blockchain ownership transfer returned no transaction hash for investment ${investmentId}.`,
        );
      }

      /**
       * --------------------------------------------------------
       * 4. Finalize database state & transition to CONFIRMED
       * --------------------------------------------------------
       */
      await this.investmentService.finalizeTokenization(investmentId, txHash);

      this.logger.log(
        `[Queue] Successfully finalized hybrid investment ${investmentId}. txHash=${txHash}`,
      );
    } catch (error: any) {
      const message = error?.message || 'Unknown investment processing error';

      this.logger.error(
        `[Queue] Failed processing ${investmentId}: ${message}`,
        error?.stack,
      );

      /**
       * handleInvestmentFailure() must be idempotent.
       * It should release reserved shares/funds exactly once.
       */
      try {
        await this.investmentService.handleInvestmentFailure(
          investmentId,
          message,
        );
      } catch (failureError: any) {
        this.logger.error(
          `[Queue] Failed to mark investment ${investmentId} as failed: ${failureError?.message}`,
          failureError?.stack,
        );
      }

      /**
       * Re-throw so Bull can retry according to queue configuration.
       */
      throw error;
    }
  }

  @Process('verify-onchain-investment')
  async verifyOnChainInvestment(
    job: Job<{
      investmentId: string;
      txHash: string;
    }>,
  ) {
    const { investmentId, txHash } = job.data;

    return this.investmentService.verifyOnChainInvestment(investmentId, txHash);
  }
}
