import { Controller, Post, Body, Param, Get } from '@nestjs/common';
import { TradeService } from './trade.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { ExecuteTradeDto } from './dto/excute-trade.dto';
import { User } from 'src/user/user.entity';

@Controller('secondary-market/trade')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  @Post('create/:sellerId')
  async create(
    @Param('sellerId') sellerId: string,
    @Body() dto: CreateTradeDto,
  ) {
    const seller = { id: sellerId } as User;
    return this.tradeService.createTrade(dto, seller);
  }

  @Post('execute/:buyerId')
  async execute(
    @Param('buyerId') buyerId: string,
    @Body() dto: ExecuteTradeDto,
  ) {
    const buyer = { id: buyerId } as User;
    return this.tradeService.executeTrade(dto, buyer);
  }

  @Get()
  async allTrades() {
    return this.tradeService.getTrades();
  }
}
