import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from './trade.entity';
import { CreateTradeDto } from './dto/create-trade.dto';
import { ExecuteTradeDto } from './dto/excute-trade.dto';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { LedgerType } from 'src/ledger/enums/ledger-type.enum';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { TradeLockService } from './trade-lock.service';
import { User } from 'src/user/user.entity';
import { Investment } from 'src/investment/investment.entity';
@Injectable()
export class TradeService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
    private readonly tradeLockService: TradeLockService,
  ) {}

  async createTrade(dto: CreateTradeDto, seller: User): Promise<Trade> {
    const trade = this.tradeRepo.create({
      investment: { id: dto.investmentId } as Investment,
      seller,
      price: dto.price,
      status: TradeStatus.PENDING,
    });
    return this.tradeRepo.save(trade);
  }

  async executeTrade(dto: ExecuteTradeDto, buyer: User): Promise<Trade> {
    const trade = await this.tradeRepo.findOne({
      where: { id: dto.tradeId },
      relations: ['seller', 'investment'],
    });
    if (!trade) throw new BadRequestException('Trade not found');
    if (trade.status !== TradeStatus.PENDING)
      throw new BadRequestException('Trade already executed');

    // Phase 8: Lock
    if (!this.tradeLockService.lock(trade.id)) {
      throw new BadRequestException(
        'Trade is being executed by another process',
      );
    }

    try {
      // Phase 8: Debit buyer
      await this.walletService.debit(
        buyer.id,
        trade.price,
        'Secondary market purchase',
      );

      // Phase 8: Credit seller
      await this.walletService.credit(
        trade.seller.id,
        trade.price,
        LedgerSource.PAYOUT_COMPLETED,
        'Secondary market sale',
      );

      // Phase 7: Update trade
      trade.buyer = buyer;
      trade.status = TradeStatus.COMPLETED;
      await this.tradeRepo.save(trade);

      // Ledger entry
      await this.ledgerService.record({
        userId: buyer.id,
        amount: trade.price,
        type: LedgerType.PAYOUT,
        source: LedgerSource.PAYOUT_COMPLETED,
        reference: trade.id,
      });

      await this.ledgerService.record({
        userId: trade.seller.id,
        amount: trade.price,
        type: LedgerType.DISTRIBUTION,
        source: LedgerSource.DISTRIBUTION_ENGINE,
        reference: trade.id,
      });

      return trade;
    } finally {
      this.tradeLockService.unlock(trade.id);
    }
  }

  async getTrades(): Promise<Trade[]> {
    return this.tradeRepo.find({
      relations: ['buyer', 'seller', 'investment'],
    });
  }
}
