import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
import { ConfigService } from '@nestjs/config';

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
    private readonly configService: ConfigService,
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
    settlementMode: 'OFF_CHAIN' | 'ON_CHAIN' = 'OFF_CHAIN', // Default to off-chain for backwards compatibility
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

          const sellerProfile = await this.ownershipService.getInvestorByUserId(
            listing.sellerId,
          );

          if (settlementMode === 'ON_CHAIN') {
            // --- ON-CHAIN ATOMIC PATH ---
            // 1. Verify buyer has enough token allowance for MockUSDC and is whitelisted
            const asset = await manager.findOne(Asset, {
              where: { id: listing.assetId },
            });
            if (!asset) throw new NotFoundException('Asset not found');

            const stablecoinAddress = this.configService.get<string>(
              'NEXT_PUBLIC_STABLECOIN_ADDRESS',
            )!;
            const marketplaceAddress =
              this.blockchainService.getMarketplaceAddress();

            // Check buyer's MockUSDC allowance towards Marketplace
            const buyerAllowance = await this.blockchainService.getAllowance(
              stablecoinAddress,
              buyer.user.walletAddress!,
              marketplaceAddress,
            );

            if (buyerAllowance < BigInt(totalPrice)) {
              throw new BadRequestException(
                'Insufficient MockUSDC allowance. Please approve the marketplace first.',
              );
            }

            // 2. Execute directly on-chain via Smart Contract (passing 6 decimals for MockUSDC)
            const receipt = await this.blockchainService.executeOnChainTrade(
              listingId,
              stablecoinAddress,
              ethers.parseUnits(totalPrice.toString(), 6).toString(),
            );

            // 3. Record completed Trade in DB immediately since settlement is atomic on-chain
            const trade = manager.create(Trade, {
              buyer,
              seller: sellerProfile,
              listingId: listing.id,
              asset: { id: listing.assetId } as any,
              units: Number(listing.unitsForSale),
              pricePerUnit: listing.pricePerUnit,
              totalPrice,
              status: TradeStatus.COMPLETED,
              txHash: receipt.hash,
              executedAt: new Date(),
            });

            const savedTrade = await manager.save(trade);

            // 4. Mirror state change in internal off-chain ledger/ownership tables for UI consistency
            await this.ownershipService.removeUnits(
              sellerProfile.id,
              listing.assetId,
              Number(listing.unitsForSale),
              manager,
            );
            await this.ownershipService.addUnits(
              buyer,
              listing.assetId,
              Number(listing.unitsForSale),
              manager,
            );

            listing.status = ListingStatus.SOLD;
            await manager.save(listing);

            await this.auditService.log(
              {
                adminId: buyer.user.id,
                targetId: savedTrade.id,
                action: AdminAction.TRADE_COMPLETED,
                reason: `On-chain atomic trade settled successfully (TX: ${receipt.hash})`,
              },
              manager,
            );

            return savedTrade;
          } else {
            // --- EXISTING OFF-CHAIN ESCROW PATH (Untouched) ---
            const buyerBalance = await this.walletService.getAvailableBalance(
              buyer.user.id,
            );

            if (Number(buyerBalance) < totalPrice) {
              throw new BadRequestException('Insufficient balance.');
            }

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
          }
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
      const marketplaceAddress = this.blockchainService.getMarketplaceAddress();
      const currentAllowance = await this.blockchainService.getAllowance(
        trade.asset.tokenAddress,
        trade.seller.user.walletAddress!,
        marketplaceAddress,
      );

      if (currentAllowance < BigInt(trade.units)) {
        throw new BadRequestException(
          'Seller allowance insufficient. Trade aborted.',
        );
      }

      // 3. Perform Blockchain Settlement (passing 6 decimals for MockUSDC)
      const priceInUnits = ethers
        .parseUnits(trade.totalPrice.toString(), 6)
        .toString();

      const receipt = await this.blockchainService.settleTrade(
        trade.listingId,
        trade.seller.user.walletAddress!,
        trade.buyer.user.walletAddress!,
        priceInUnits,
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

  async syncOnChainTrade(
    listingId: string,
    buyer: InvestorProfile,
    txHash: string,
  ): Promise<Trade> {
    return await this.tradeRepo.manager.transaction(
      async (manager: EntityManager) => {
        // 1. Fetch and lock the listing
        const listing = await manager
          .getRepository(SecondaryMarketListing)
          .createQueryBuilder('listing')
          .setLock('pessimistic_write')
          .where('listing.id = :listingId', { listingId })
          .getOne();

        if (!listing || listing.status !== ListingStatus.ACTIVE) {
          throw new BadRequestException(
            'Listing is no longer active or already processed',
          );
        }

        const totalPrice =
          Number(listing.unitsForSale) * Number(listing.pricePerUnit);
        const sellerProfile = await this.ownershipService.getInvestorByUserId(
          listing.sellerId,
        );

        // 2. Create the completed Trade record with the frontend's txHash
        const trade = manager.create(Trade, {
          buyer,
          seller: sellerProfile,
          listingId: listing.id,
          asset: { id: listing.assetId } as any,
          units: Number(listing.unitsForSale),
          pricePerUnit: listing.pricePerUnit,
          totalPrice,
          status: TradeStatus.COMPLETED,
          txHash: txHash,
          executedAt: new Date(),
        });

        const savedTrade = await manager.save(trade);

        // 3. Mirror the blockchain state change in your internal database tables
        await this.ownershipService.removeUnits(
          sellerProfile.id,
          listing.assetId,
          Number(listing.unitsForSale),
          manager,
        );

        await this.ownershipService.addUnits(
          buyer,
          listing.assetId,
          Number(listing.unitsForSale),
          manager,
        );

        // 4. Mark listing as SOLD
        listing.status = ListingStatus.SOLD;
        await manager.save(listing);

        // 5. Audit log
        await this.auditService.log(
          {
            adminId: buyer.user.id,
            targetId: savedTrade.id,
            action: AdminAction.TRADE_COMPLETED,
            reason: `On-chain atomic trade synced successfully via frontend (TX: ${txHash})`,
          },
          manager,
        );

        return savedTrade;
      },
    );
  }
}
