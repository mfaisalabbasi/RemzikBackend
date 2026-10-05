import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { getQueueToken } from '@nestjs/bull';
import type { Queue } from 'bull';

import { InvestmentService } from './investment.service';

import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { KycGuard } from 'src/auth/guards/kyc.guard';

import { UserRole } from '../user/enums/user-role.enum';
import { InvestmentStatus } from './enums/investment-status.enum';

import { CreateInvestmentDto } from './dto/create-investment.dto';
import { CreateInvestmentIntentDto } from './dto/create-investment-intent.dto';
import { SubmitTxDto } from './dto/submit-tx.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('investments')
export class InvestmentController {
  constructor(
    private readonly investmentService: InvestmentService,

    @Inject(getQueueToken('investment-queue'))
    private readonly investmentQueue: Queue,
  ) {}

  // =========================================================
  // OFF-CHAIN INVESTMENT
  // =========================================================

  @Post()
  @UseGuards(KycGuard)
  @Roles(UserRole.INVESTOR)
  async create(@Req() req: any, @Body() dto: CreateInvestmentDto) {
    if (dto.settlementMode === 'ON_CHAIN') {
      throw new HttpException(
        'On-chain investments must use the investment intent flow.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      await Promise.race([
        this.investmentQueue.client.ping(),

        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 800),
        ),
      ]);
    } catch {
      throw new HttpException(
        'Investment service is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return this.investmentService.createInvestment(req.user.userId, dto);
  }

  // =========================================================
  // ON-CHAIN INTENT
  // =========================================================

  @Post('intent')
  @UseGuards(KycGuard)
  @Roles(UserRole.INVESTOR)
  async createIntent(@Req() req: any, @Body() dto: CreateInvestmentIntentDto) {
    return this.investmentService.createInvestmentIntent(req.user.userId, dto);
  }

  // =========================================================
  // SUBMIT INVESTOR-SIGNED TX
  // =========================================================

  @Post(':id/submit-tx')
  @UseGuards(KycGuard)
  @Roles(UserRole.INVESTOR)
  async submitTransaction(
    @Req() req: any,
    @Param('id') investmentId: string,
    @Body() dto: SubmitTxDto,
  ) {
    // 1. Save the transaction hash to the investment record first
    await this.investmentService.submitOnChainTransaction(
      req.user.userId,
      investmentId,
      dto.txHash,
    );

    // 2. Immediately execute full on-chain validation & finalization pipeline
    return this.investmentService.verifyOnChainInvestment(
      investmentId,
      dto.txHash,
    );
  }

  // =========================================================
  // LEGACY ADMIN CONFIRM
  // =========================================================

  @Patch(':id/confirm')
  @Roles(UserRole.ADMIN)
  async confirm(@Param('id') id: string) {
    return this.investmentService.confirmInvestment(id);
  }

  // =========================================================
  // MY INVESTMENTS
  // =========================================================

  @Get('me')
  @Roles(UserRole.INVESTOR)
  async getMy(@Req() req: any) {
    return this.investmentService.getMyInvestments(req.user.userId);
  }

  // =========================================================
  // LIVE INVESTMENT STATUS & AUTO-VERIFICATION
  // =========================================================

  @Get(':id/db-status')
  @Roles(UserRole.INVESTOR)
  async getLiveInvestmentStatus(@Req() req: any, @Param('id') id: string) {
    // 1. If PENDING and a transaction hash exists, try auto-triggering on-chain verification first
    try {
      const current = await this.investmentService.getLiveStatus(
        id,
        req.user.userId,
      );

      if (
        current &&
        current.status === InvestmentStatus.PENDING &&
        current.txHash
      ) {
        await this.investmentService.verifyOnChainInvestment(
          id,
          current.txHash,
        );
      }
    } catch (error: any) {
      // Suppress transient block-propagation errors, but let it proceed to fetch the latest db state
      console.log('Auto-verification check warning:', error?.message);
    }

    // 2. Always return the freshest state from the database so the polling loop gets a valid status object
    return this.investmentService.getLiveStatus(id, req.user.userId);
  }
}
