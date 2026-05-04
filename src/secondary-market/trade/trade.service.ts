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
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { CreateTradeDto } from './dto/create-trade.dto';
import { EscrowService } from 'src/escrow/escrow.service';
import { Escrow } from 'src/escrow/escrow.entity';

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
    private readonly escrowService: EscrowService,
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

    if (listing.sellerId === buyer.user.id) {
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
          const sellerProfile = await this.ownershipService.getInvestorByUserId(
            listing.sellerId,
          );

          // 1. Create Trade Record First (to get ID for Escrow)
          const trade = this.tradeRepo.create({
            buyer,
            seller: sellerProfile,
            asset: { id: listing.assetId } as any,
            units: unitsToBuy,
            pricePerUnit: listing.pricePerUnit,
            totalPrice: totalPrice,
            status: TradeStatus.LOCKED,
            executedAt: new Date(),
          });

          const savedTrade = await manager.save(trade);

          // 2. USE ESCROW SERVICE
          // This deducts from Available, adds to Locked, and creates Escrow record
          await this.escrowService.createEscrow(
            {
              tradeId: savedTrade.id,
              buyerId: buyer.user.id,
              sellerId: listing.sellerId,
              amount: totalPrice,
              lockDays: 3,
            },
            manager,
          );

          await this.ownershipService.removeUnits(
            sellerProfile.id,
            listing.assetId,
            unitsToBuy,
            manager,
          );

          await this.ownershipService.addUnits(
            buyer,
            listing.assetId,
            unitsToBuy,
            manager,
          );

          listing.status = ListingStatus.SOLD;
          await manager.save(listing);

          await this.auditService.log(
            {
              adminId: buyer.user.id,
              targetId: savedTrade.id,
              action: AdminAction.TRADE_EXECUTED,
              reason: `P2P Purchase (Escrow Locked): ${unitsToBuy} units @ ${listing.pricePerUnit} SAR`,
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

  async settleTrade(tradeId: string, currentUserId: string): Promise<Trade> {
    return await this.tradeRepo.manager.transaction(
      async (manager: EntityManager) => {
        const trade = await manager.findOne(Trade, {
          where: { id: tradeId },
          relations: ['seller', 'seller.user', 'buyer', 'buyer.user'],
        });

        if (!trade) throw new BadRequestException('Trade not found');

        if (trade.buyer.user.id !== currentUserId) {
          throw new BadRequestException(
            'Unauthorized: Only the buyer can release escrowed funds',
          );
        }

        if (trade.status !== TradeStatus.LOCKED) {
          throw new BadRequestException(
            `Cannot settle trade in ${trade.status} status`,
          );
        }

        // 1. Release via Escrow Service
        // FIX: Use the Escrow entity class instead of a string to ensure type safety
        const escrow = await manager.findOne(Escrow, { where: { tradeId } });
        if (escrow) {
          await this.escrowService.releaseEscrow(escrow.id, manager);
        } else {
          // Fallback if record was missing
          await this.walletService.creditAvailable(
            trade.seller.user.id,
            trade.totalPrice,
            manager,
          );
        }

        trade.status = TradeStatus.COMPLETED;
        const updatedTrade = await manager.save(trade);

        await this.auditService.log(
          {
            adminId: currentUserId,
            targetId: trade.id,
            action: AdminAction.TRADE_COMPLETED,
            reason: `Escrow released by buyer: Funds transferred to seller for trade ${trade.id}`,
          },
          manager,
        );

        return updatedTrade;
      },
    );
  }

  async getTrades() {
    return this.tradeRepo.find({
      relations: ['seller', 'buyer', 'asset'],
      order: { executedAt: 'DESC' },
    });
  }

  async getUserTrades(userId: string): Promise<Trade[]> {
    return this.tradeRepo.find({
      where: [
        { buyer: { user: { id: userId } }, status: TradeStatus.LOCKED },
        { seller: { user: { id: userId } }, status: TradeStatus.LOCKED },
      ],
      relations: ['seller', 'buyer', 'asset', 'seller.user', 'buyer.user'],
      order: { executedAt: 'DESC' },
    });
  }

  async getTradeForDispute(tradeId: string): Promise<Trade> {
    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId },
      relations: ['buyer', 'seller', 'buyer.user', 'seller.user'],
    });

    if (!trade) {
      throw new BadRequestException(
        'Trade record not found in the Remzik ledger',
      );
    }

    if (trade.status !== TradeStatus.LOCKED) {
      throw new BadRequestException(
        `Dispute denied: Trade status is ${trade.status}. Only LOCKED trades can be disputed.`,
      );
    }

    return trade;
  }
}
