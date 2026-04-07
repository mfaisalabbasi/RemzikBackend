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

  @Post('execute/:tradeId')
  async execute(
    @CurrentUser('userId') userId: string,
    @Param('tradeId') tradeId: string,
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');

    const buyerProfile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!buyerProfile)
      throw new BadRequestException('Investor profile for buyer not found');

    return this.tradeService.executeTrade(tradeId, buyerProfile);
  }

  @Get()
  async allTrades() {
    return this.tradeService.getTrades();
  }
}
