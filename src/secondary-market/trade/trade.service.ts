import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Trade } from './trade.entity';
import { TradeStatus } from './enums/trade-status.enum';
import { TradeLockService } from './trade-lock.service';
import { OwnershipService } from 'src/ownership/ownership.service';
import { WalletService } from 'src/wallet/wallet.service';
import { ListingService } from '../listing/listing.service';
import { ListingStatus } from '../listing/enums/listing-status.enum';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from 'src/asset/asset.entity';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { CreateTradeDto } from './dto/create-trade.dto';

@Injectable()
export class TradeService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly ownershipService: OwnershipService,
    private readonly walletService: WalletService,
    private readonly tradeLockService: TradeLockService,
    private readonly listingService: ListingService,
    private readonly auditService: AuditService,
  ) {}

  async createTrade(
    seller: InvestorProfile,
    dto: CreateTradeDto,
  ): Promise<Trade> {
    const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
      seller.user.id,
      dto.assetId,
    );

    if (Number(ownedUnits) < Number(dto.units)) {
      throw new BadRequestException(
        `Insufficient units. You own ${ownedUnits}`,
      );
    }

    const trade = this.tradeRepo.create({
      seller,
      asset: { id: dto.assetId } as Asset,
      units: dto.units,
      pricePerUnit: dto.pricePerUnit,
      totalPrice: Number(dto.units) * Number(dto.pricePerUnit),
      status: TradeStatus.PENDING,
    });

    return this.tradeRepo.save(trade);
  }

  async executeTrade(
    listingId: string,
    buyer: InvestorProfile,
  ): Promise<Trade> {
    const listing = await this.listingService.getListingById(listingId);

    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Listing is no longer active');
    }

    const unitsToBuy = Number(listing.unitsForSale);
    const totalPrice = unitsToBuy * Number(listing.pricePerUnit);

    // Prevent self-trading
    if (listing.sellerId === buyer.id || listing.sellerId === buyer.user.id) {
      throw new BadRequestException('Self-trading is not permitted');
    }

    const buyerBalance = await this.walletService.getAvailableBalance(
      buyer.user.id,
    );

    if (Number(buyerBalance) < totalPrice) {
      throw new BadRequestException(
        `Insufficient balance. Have: ${buyerBalance} SAR, Need: ${totalPrice} SAR`,
      );
    }

    if (!this.tradeLockService.lock(listingId)) {
      throw new BadRequestException('Transaction in progress...');
    }

    try {
      return await this.tradeRepo.manager.transaction(
        async (manager: EntityManager) => {
          // --- 1. RESOLVE SELLER CONTEXT ---
          // This is the CRITICAL fix. We find the InvestorProfile linked to the sellerId.
          // This ensures we get the real investorId even if the listing stored a userId.
          const sellerProfile = await this.ownershipService.getInvestorByUserId(
            listing.sellerId,
          );

          // --- 2. FINANCIAL SETTLEMENT ---
          await this.walletService.debitAvailable(
            buyer.user.id,
            totalPrice,
            manager,
          );

          await this.walletService.credit(
            listing.sellerId,
            totalPrice,
            LedgerSource.SECONDARY_MARKET_SELL,
            `Sale of ${unitsToBuy} units of ${listing.assetId}`,
            manager,
          );

          // --- 3. OWNERSHIP TRANSFER ---
          // Use sellerProfile.id to guarantee the lookup in the ownerships table works.
          await this.ownershipService.removeUnits(
            sellerProfile.id,
            listing.assetId,
            unitsToBuy,
            manager,
          );

          // Buyer gains units. Passing the profile object handles "add or create" logic.
          await this.ownershipService.addUnits(
            buyer,
            listing.assetId,
            unitsToBuy,
            manager,
          );

          // --- 4. UPDATE LISTING ---
          listing.status = ListingStatus.SOLD;
          await manager.save(listing);

          // --- 5. RECORD TRADE ---
          const trade = this.tradeRepo.create({
            buyer,
            seller: sellerProfile, // Now using the full resolved profile
            asset: { id: listing.assetId } as any,
            units: unitsToBuy,
            pricePerUnit: listing.pricePerUnit,
            totalPrice: totalPrice,
            status: TradeStatus.COMPLETED,
            executedAt: new Date(),
          });

          const savedTrade = await manager.save(trade);

          // --- 6. AUDIT ---
          await this.auditService.log(
            {
              adminId: buyer.user.id,
              targetId: savedTrade.id,
              action: AdminAction.TRADE_EXECUTED,
              reason: `P2P Purchase: ${unitsToBuy} units @ ${listing.pricePerUnit} SAR`,
            },
            manager,
          );

          return savedTrade;
        },
      );
    } catch (error: any) {
      console.error('Execution Error Details:', error.message);
      throw new InternalServerErrorException(
        'Execution failed: ' + error.message,
      );
    } finally {
      this.tradeLockService.unlock(listingId);
    }
  }

  async getTrades() {
    return this.tradeRepo.find({
      relations: ['seller', 'buyer', 'asset'],
      order: { executedAt: 'DESC' },
    });
  }
}
