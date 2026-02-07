import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Trade } from './trade.entity';
import { TradeStatus } from './enums/trade-status.enum';
import { CreateTradeDto } from './dto/create-trade.dto';
import { TradeLockService } from './trade-lock.service';
import { OwnershipService } from 'src/ownership/ownership.service';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from 'src/asset/asset.entity';

@Injectable()
export class TradeService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly ownershipService: OwnershipService,
    private readonly tradeLockService: TradeLockService,
  ) {}

  /*
  =====================================================
  CREATE TRADE
  =====================================================
  */
  async createTrade(
    sellerProfile: InvestorProfile,
    dto: CreateTradeDto,
  ): Promise<Trade> {
    if (!sellerProfile) throw new BadRequestException('Invalid seller profile');
    if (dto.units <= 0)
      throw new BadRequestException('Units must be greater than 0');
    if (dto.pricePerUnit <= 0)
      throw new BadRequestException('Price must be greater than 0');

    // ✅ Check seller units using userId
    const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
      sellerProfile.user.id,
      dto.assetId,
    );

    if (ownedUnits < dto.units)
      throw new BadRequestException(
        `Insufficient units. You own ${ownedUnits}`,
      );

    const trade = this.tradeRepo.create({
      seller: sellerProfile,
      asset: { id: dto.assetId } as Asset,
      units: dto.units,
      pricePerUnit: dto.pricePerUnit,
      totalPrice: dto.units * dto.pricePerUnit,
      status: TradeStatus.PENDING,
    });

    return this.tradeRepo.save(trade);
  }

  /*
  =====================================================
  EXECUTE TRADE
  =====================================================
  */
  async executeTrade(
    tradeId: string,
    buyerProfile: InvestorProfile,
  ): Promise<Trade> {
    if (!buyerProfile) throw new BadRequestException('Invalid buyer profile');

    // 🔍 Fetch trade with seller and asset including user relation
    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId },
      relations: ['seller', 'seller.user', 'asset'],
    });

    if (!trade) throw new BadRequestException('Trade not found');
    if (trade.status !== TradeStatus.PENDING)
      throw new BadRequestException('Trade already executed');
    if (trade.seller.id === buyerProfile.id)
      throw new BadRequestException('Cannot execute own trade');

    if (!trade.seller.user)
      throw new BadRequestException('Seller user not loaded');

    // 🔐 LOCK trade execution
    if (!this.tradeLockService.lock(trade.id))
      throw new BadRequestException('Trade being executed elsewhere');

    try {
      const sellerUserId = trade.seller.user.id; // for getUserUnitsForAsset
      const sellerInvestorId = trade.seller.id; // for removeUnits
      const buyerUserId = buyerProfile.user.id; // for addUnits via string
      const buyerInvestorId = buyerProfile.id; // for addUnits via object

      // 1️⃣ Check seller units using userId
      const sellerUnits = await this.ownershipService.getUserUnitsForAsset(
        sellerUserId,
        trade.asset.id,
      );

      if (sellerUnits < trade.units)
        throw new BadRequestException('Seller no longer owns required units');

      // 2️⃣ Transfer ownership
      await this.ownershipService.removeUnits(
        trade.seller.id, // investorId
        trade.asset.id,
        trade.units,
      );
      await this.ownershipService.addUnits(
        buyerUserId,
        trade.asset.id,
        trade.units,
      ); // pass userId string

      // 3️⃣ Update trade record
      trade.buyer = buyerProfile;
      trade.status = TradeStatus.COMPLETED;
      trade.executedAt = new Date();

      return await this.tradeRepo.save(trade);
    } finally {
      this.tradeLockService.unlock(trade.id);
    }
  }

  /*
  =====================================================
  GET ALL TRADES
  =====================================================
  */
  async getTrades(): Promise<Trade[]> {
    return this.tradeRepo.find({
      relations: ['buyer', 'buyer.user', 'seller', 'seller.user', 'asset'],
    });
  }
}
