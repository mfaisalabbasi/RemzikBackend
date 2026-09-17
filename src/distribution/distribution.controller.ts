import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Param,
  Get,
} from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';

@Controller('distributions')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  /**
   * ✅ FIXED: Destructured body parsing + Accurate Strategy property matching
   */
  @UseGuards(JwtAuthGuard)
  @Post('trigger-from-income')
  async triggerFromIncome(@Body() body: { incomeId: string }, @Request() req) {
    const incomeId = body?.incomeId;
    if (!incomeId) {
      throw new BadRequestException(
        'The payload field "incomeId" is missing or unreadable.',
      );
    }

    // 🛡️ MATCHES STRATEGY: Grab "userId", not "id"
    const partnerUserId = req.user?.userId;

    return await this.distributionService.triggerDistributionFromIncome(
      incomeId,
      partnerUserId,
    );
  }

  /**
   * ✅ FIXED: Legacy route property tracking adjustment
   */
  @UseGuards(JwtAuthGuard)
  @Post('partner/assets/:id/distribute')
  async distribute(
    @Param('id') assetId: string,
    @Body('amount') amount: number,
    @Request() req,
  ) {
    // 🛡️ MATCHES STRATEGY: Grab "userId"
    const partnerUserId = req.user?.userId;

    return await this.distributionService.triggerYieldDistribution(
      partnerUserId,
      assetId,
      amount,
    );
  }

  /**
   * 🌟 ADMIN: Get global pending distribution batches awaiting trigger/approval
   */
  @UseGuards(JwtAuthGuard)
  @Get('admin/pending-batches')
  async getPendingBatches() {
    return await this.distributionService.getGlobalPendingBatches();
  }

  /**
   * 🌟 ADMIN: Approve & trigger on-chain Merkle root / payout activation
   */
  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:batchId/approve')
  async approveBatch(@Param('batchId') batchId: string) {
    return await this.distributionService.approveDistributionBatch(batchId);
  }

  /**
   * 🌟 ADMIN: Reject pending distribution batch
   */
  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:batchId/reject')
  async rejectBatch(
    @Param('batchId') batchId: string,
    @Body('reason') reason: string,
  ) {
    return await this.distributionService.rejectDistributionBatch(
      batchId,
      reason || 'Rejected by admin',
    );
  }

  /**
   * 🌲 FETCH MERKLE PROOF FOR USER CLAIM
   */
  @UseGuards(JwtAuthGuard)
  @Get('proof/:batchId')
  async getYieldProof(@Param('batchId') batchId: string, @Request() req) {
    const userId = req.user?.userId;
    return await this.distributionService.getUserMerkleProof(batchId, userId);
  }

  /**
   * 🌟 CONFIRM ON-CHAIN CLAIM & SYNC DB STATE TO PAID
   */
  @UseGuards(JwtAuthGuard)
  @Post('confirm-onchain-claim')
  async confirmOnChainClaim(@Body() body: { batchId: string }, @Request() req) {
    const batchId = body?.batchId;
    if (!batchId) {
      throw new BadRequestException('The payload field "batchId" is required.');
    }
    const userId = req.user?.userId;
    return await this.distributionService.confirmOnChainClaim(batchId, userId);
  }
}
