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

  /**
   * ✅ Create Trade
   * Seller identity resolved via InvestorProfile
   */
  @Post('create')
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTradeDto,
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');
    // Fetch seller's investor profile including 'user' relation
    const sellerProfile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'], // ✅ important to avoid null result
    });
    if (!sellerProfile)
      throw new BadRequestException('Investor profile for seller not found');
    // Delegate trade creation
    return this.tradeService.createTrade(sellerProfile, dto);
  }

  /**
   * ✅ Execute Trade
   * Buyer identity resolved via InvestorProfile
   */
  @Post('execute/:tradeId')
  async execute(
    @CurrentUser('userId') userId: string,
    @Param('tradeId') tradeId: string,
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');

    // Fetch buyer's investor profile including 'user' relation
    const buyerProfile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'], // ✅ important to avoid null result
    });

    if (!buyerProfile)
      throw new BadRequestException('Investor profile for buyer not found');
    // Delegate trade execution
    return this.tradeService.executeTrade(tradeId, buyerProfile);
  }

  /**
   * ✅ Get all trades
   */
  @Get()
  async allTrades() {
    return this.tradeService.getTrades();
  }
}
