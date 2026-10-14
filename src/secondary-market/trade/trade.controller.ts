import {
  Controller,
  Post,
  Body,
  Get,
  BadRequestException,
  UseGuards,
  Param,
} from '@nestjs/common';
import { TradeService } from './trade.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { InvestorProfile } from 'src/investor/investor.entity';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('secondary-market/trade')
export class TradeController {
  constructor(
    private readonly tradeService: TradeService,
    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,
  ) {}

  @Post('create')
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTradeDto,
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');

    const sellerProfile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!sellerProfile)
      throw new BadRequestException('Investor profile for seller not found');

    return this.tradeService.createTrade(sellerProfile, dto);
  }

  // =========================================================
  // ON-CHAIN TRADE INTENT
  // =========================================================

  @Post('intent')
  async createIntent(
    @CurrentUser('userId') userId: string,
    @Body()
    body: {
      listingId: string;
      settlementMode?: 'OFF_CHAIN' | 'ON_CHAIN';
    },
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');

    const buyerProfile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!buyerProfile)
      throw new BadRequestException('Investor profile for buyer not found');

    return this.tradeService.createTradeIntent(
      body.listingId,
      buyerProfile,
      body?.settlementMode || 'ON_CHAIN',
    );
  }

  // =========================================================
  // SUBMIT INVESTOR-SIGNED ON-CHAIN TX
  // =========================================================

  @Post(':id/submit-tx')
  async submitTransaction(
    @CurrentUser('userId') userId: string,
    @Param('id') tradeId: string,
    @Body() body: { txHash: string },
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');

    // 1. Save and bind the transaction hash to the trade intent record
    await this.tradeService.submitOnChainTransaction(
      userId,
      tradeId,
      body.txHash,
    );

    // 2. Immediately trigger on-chain verification pipeline & final settlement
    return this.tradeService.verifyOnChainTrade(tradeId, body.txHash);
  }

  // =========================================================
  // LEGACY EXECUTE ROUTE (Supports both Off-Chain Escrow & On-Chain Sync)
  // =========================================================

  @Post('execute/:listingId')
  async execute(
    @CurrentUser('userId') userId: string,
    @Param('listingId') listingId: string,
    @Body()
    body: {
      settlementMode?: 'OFF_CHAIN' | 'ON_CHAIN';
      txHash?: string;
    },
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');

    const buyerProfile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!buyerProfile)
      throw new BadRequestException('Investor profile for buyer not found');

    const mode = body?.settlementMode || 'OFF_CHAIN';

    if (mode === 'ON_CHAIN') {
      if (!body?.txHash) {
        throw new BadRequestException(
          'Transaction hash is required for on-chain sync',
        );
      }
      return this.tradeService.syncOnChainTrade(
        listingId,
        buyerProfile,
        body.txHash,
      );
    }

    // Fallback to existing off-chain escrow execution flow
    return this.tradeService.executeTrade(listingId, buyerProfile, mode);
  }

  // =========================================================
  // LIVE TRADE STATUS & AUTO-VERIFICATION
  // =========================================================

  @Get(':id/db-status')
  async getLiveTradeStatus(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    // 1. If PENDING and a transaction hash exists, auto-trigger on-chain verification check
    try {
      const current = await this.tradeService.getLiveStatus(id, userId);

      if (current && current.status === ('PENDING' as any) && current.txHash) {
        await this.tradeService.verifyOnChainTrade(id, current.txHash);
      }
    } catch (error: any) {
      console.log('Trade auto-verification check warning:', error?.message);
    }

    // 2. Return freshest state from DB
    return this.tradeService.getLiveStatus(id, userId);
  }

  @Get()
  async allTrades() {
    return this.tradeService.getTrades();
  }

  @Get('active')
  async getActiveTrades(@CurrentUser('userId') userId: string) {
    return this.tradeService.getUserTrades(userId);
  }

  @Post('settle/:tradeId')
  async settle(
    @CurrentUser('userId') userId: string,
    @Param('tradeId') tradeId: string,
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');
    return await this.tradeService.settleTrade(tradeId, userId);
  }
}
