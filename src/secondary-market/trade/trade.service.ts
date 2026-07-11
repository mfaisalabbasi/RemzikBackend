import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { ethers } from 'ethers';
import { Trade } from './trade.entity';
import { TradeStatus } from './enums/trade-status.enum';
import { TradeLockService } from './trade-lock.service';
import { OwnershipService } from 'src/ownership/ownership.service';
import { WalletService } from 'src/wallet/wallet.service';
import { ListingStatus } from '../listing/enums/listing-status.enum';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from 'src/asset/asset.entity';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { CreateTradeDto } from './dto/create-trade.dto';
import { EscrowService } from 'src/escrow/escrow.service';
import { Escrow } from 'src/escrow/escrow.entity';
import { SecondaryMarketListing } from '../listing/listing.entity';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { Mutex } from 'async-mutex';

@Injectable()
export class TradeService {
  private readonly settlementMutex = new Mutex();
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly ownershipService: OwnershipService,
    private readonly walletService: WalletService,
    private readonly tradeLockService: TradeLockService,
    private readonly auditService: AuditService,
    private readonly escrowService: EscrowService,
    private readonly blockchainService: BlockchainService,
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
    if (!this.tradeLockService.lock(listingId)) {
      throw new BadRequestException('Transaction in progress...');
    }
    try {
      return await this.tradeRepo.manager.transaction(
        async (manager: EntityManager) => {
          const listing = await manager
            .getRepository(SecondaryMarketListing)
            .createQueryBuilder('listing')
            .setLock('pessimistic_write')
            .where('listing.id = :listingId', { listingId })
            .getOne();

          if (!listing || listing.status !== ListingStatus.ACTIVE) {
            throw new BadRequestException('Listing is no longer active');
          }

          const totalPrice =
            Number(listing.unitsForSale) * Number(listing.pricePerUnit);
          const buyerBalance = await this.walletService.getAvailableBalance(
            buyer.user.id,
          );

          if (Number(buyerBalance) < totalPrice) {
            throw new BadRequestException('Insufficient balance.');
          }

          const sellerProfile = await this.ownershipService.getInvestorByUserId(
            listing.sellerId,
          );
          const trade = manager.create(Trade, {
            buyer,
            seller: sellerProfile,
            listingId: listing.id,
            asset: { id: listing.assetId } as any,
            units: Number(listing.unitsForSale),
            pricePerUnit: listing.pricePerUnit,
            totalPrice,
            status: TradeStatus.LOCKED,
            executedAt: new Date(),
          });

          const savedTrade = await manager.save(trade);
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

          listing.status = ListingStatus.PENDING;
          await manager.save(listing);
          return savedTrade;
        },
      );
    } finally {
      this.tradeLockService.unlock(listingId);
    }
  }

  async settleTrade(tradeId: string, currentUserId: string): Promise<Trade> {
    return await this.settlementMutex.runExclusive(async () => {
      // 1. Fetch record for validation
      const trade = await this.tradeRepo.findOne({
        where: { id: tradeId },
        relations: ['seller', 'seller.user', 'buyer', 'buyer.user', 'asset'],
      });

      if (!trade || trade.buyer.user.id !== currentUserId)
        throw new BadRequestException('Unauthorized or trade not found');
      if (trade.status !== TradeStatus.LOCKED)
        throw new BadRequestException(
          `Cannot settle trade in ${trade.status} status`,
        );

      // 2. PRE-FLIGHT ALLOWANCE CHECK
      // This stops the process if the seller hasn't approved the marketplace,
      // preventing the "ERC20InsufficientAllowance" revert on-chain.
      const marketplaceAddress = this.blockchainService.getMarketplaceAddress();
      const currentAllowance = await this.blockchainService.getAllowance(
        trade.asset.tokenAddress, // Ensure this exists on your Asset entity
        trade.seller.user.walletAddress!,
        marketplaceAddress,
      );

      // We compare against the units being traded.
      // If you are using Infinite Approval, this will pass.
      if (currentAllowance < BigInt(trade.units)) {
        throw new BadRequestException(
          'Seller allowance insufficient. Trade aborted.',
        );
      }

      // 3. Perform Blockchain Settlement
      const priceInWei = ethers
        .parseUnits(trade.totalPrice.toString(), 18)
        .toString();

      const receipt = await this.blockchainService.settleTrade(
        trade.listingId,
        trade.seller.user.walletAddress!,
        trade.buyer.user.walletAddress!,
        priceInWei,
      );

      // 4. Atomic Database Update
      return await this.tradeRepo.manager.transaction(async (manager) => {
        const txTrade = await manager.findOne(Trade, {
          where: { id: tradeId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!txTrade || txTrade.status !== TradeStatus.LOCKED)
          throw new Error('Trade already resolved or state mismatch.');

        // Escrow and Wallet logic
        const escrow = await manager.findOne(Escrow, { where: { tradeId } });
        if (escrow) {
          await this.escrowService.releaseEscrow(escrow.id, manager);
        } else {
          await this.walletService.creditAvailable(
            trade.seller.user.id,
            trade.totalPrice,
            manager,
          );
        }

        // Ownership and Status Updates
        await this.ownershipService.removeUnits(
          trade.seller.id,
          trade.asset.id,
          trade.units,
          manager,
        );
        await this.ownershipService.addUnits(
          trade.buyer,
          trade.asset.id,
          trade.units,
          manager,
        );

        txTrade.status = TradeStatus.COMPLETED;
        txTrade.txHash = receipt.hash;
        await manager.save(txTrade);

        await manager.update(
          SecondaryMarketListing,
          { id: trade.listingId },
          { status: ListingStatus.SOLD },
        );

        await this.auditService.log(
          {
            adminId: currentUserId,
            targetId: trade.id,
            action: AdminAction.TRADE_COMPLETED,
            reason: `Settlement finalized on-chain (TX: ${receipt.hash}).`,
          },
          manager,
        );

        return txTrade;
      });
    });
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
      relations: [
        'seller',
        'buyer',
        'asset',
        'seller.user',
        'buyer.user',
        'listing',
      ],
      order: { executedAt: 'DESC' },
    });
  }

  async getTradeForDispute(tradeId: string): Promise<Trade> {
    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId },
      relations: ['buyer', 'seller', 'buyer.user', 'seller.user'],
    });
    if (!trade) throw new BadRequestException('Trade record not found');
    if (trade.status !== TradeStatus.LOCKED)
      throw new BadRequestException('Only LOCKED trades can be disputed.');
    return trade;
  }
}
