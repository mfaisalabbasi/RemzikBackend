import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { ethers } from 'ethers';
import { Trade, SettlementMode } from './trade.entity';
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
      settlementMode: SettlementMode.OFF_CHAIN,
    });

    return this.tradeRepo.save(trade);
  }

  // =========================================================
  // 1. CREATE ON-CHAIN TRADE INTENT (PENDING STATUS)
  // =========================================================
  async createTradeIntent(
    listingId: string,
    buyer: InvestorProfile,
    settlementMode: 'OFF_CHAIN' | 'ON_CHAIN' = 'ON_CHAIN',
  ) {
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
            throw new BadRequestException('Listing is no longer active.');
          }

          const sellerProfile = await this.ownershipService.getInvestorByUserId(
            listing.sellerId,
          );

          const totalPrice =
            Number(listing.unitsForSale) * Number(listing.pricePerUnit);

          const databaseWallet = buyer.user?.walletAddress;
          if (!databaseWallet || !ethers.isAddress(databaseWallet)) {
            throw new BadRequestException('Buyer wallet is not configured.');
          }

          const trade = manager.create(Trade, {
            buyer,
            seller: sellerProfile,
            listingId: listing.id,
            asset: { id: listing.assetId } as Asset,
            units: Number(listing.unitsForSale),
            pricePerUnit: listing.pricePerUnit,
            totalPrice,
            status: TradeStatus.PENDING,
            settlementMode:
              settlementMode === 'ON_CHAIN'
                ? SettlementMode.ON_CHAIN
                : SettlementMode.OFF_CHAIN,
            executedAt: new Date(),
          });

          const savedTrade = await manager.save(Trade, trade);

          listing.status = ListingStatus.PENDING;
          await manager.save(SecondaryMarketListing, listing);

          return {
            success: true,
            tradeId: savedTrade.id,
            status: TradeStatus.PENDING,
            settlementMode: savedTrade.settlementMode,
            listingId: listing.id,
            totalPrice,
          };
        },
      );
    } finally {
      this.tradeLockService.unlock(listingId);
    }
  }

  // =========================================================
  // 2. SUBMIT ON-CHAIN TRANSACTION HASH
  // =========================================================
  async submitOnChainTransaction(
    userId: string,
    tradeId: string,
    txHash: string,
  ) {
    if (!txHash || !ethers.isHexString(txHash, 32)) {
      throw new BadRequestException('Invalid transaction hash.');
    }

    const normalizedHash = txHash.toLowerCase();

    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId },
      relations: ['buyer', 'buyer.user'],
    });

    if (!trade) {
      throw new NotFoundException('Trade intent record not found.');
    }

    if (trade.buyer?.user?.id !== userId) {
      throw new ForbiddenException(
        'Unauthorized to submit transaction for this trade.',
      );
    }

    if (trade.status === TradeStatus.COMPLETED) {
      if (trade.txHash?.toLowerCase() === normalizedHash) {
        return {
          success: true,
          tradeId,
          status: TradeStatus.COMPLETED,
          txHash: trade.txHash,
        };
      }
      throw new ConflictException(
        'Trade has already been completed with another transaction.',
      );
    }

    await this.tradeRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Trade, {
        where: { id: tradeId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!locked) {
        throw new NotFoundException('Trade not found.');
      }

      if (locked.txHash && locked.txHash.toLowerCase() !== normalizedHash) {
        throw new ConflictException(
          'A different transaction hash is already linked to this trade.',
        );
      }

      locked.txHash = normalizedHash;
      locked.settlementMode = SettlementMode.ON_CHAIN;
      await manager.save(Trade, locked);
    });

    return {
      success: true,
      tradeId,
      status: trade.status,
      txHash: normalizedHash,
    };
  }

  // =========================================================
  // 3. VERIFY ON-CHAIN TRANSACTION & FINALIZE OWNERSHIP
  // =========================================================
  async verifyOnChainTrade(tradeId: string, txHash: string) {
    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId },
      relations: ['buyer', 'buyer.user', 'seller', 'seller.user', 'asset'],
    });

    if (!trade) {
      throw new NotFoundException('Trade record not found.');
    }

    if (trade.status === TradeStatus.COMPLETED) {
      return {
        success: true,
        tradeId,
        status: TradeStatus.COMPLETED,
        txHash: trade.txHash,
      };
    }

    const provider = this.blockchainService.getProvider();
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      throw new BadRequestException('Transaction not mined yet.');
    }

    if (receipt.status !== 1) {
      throw new BadRequestException('On-chain trade transaction reverted.');
    }

    return await this.tradeRepo.manager.transaction(
      async (manager: EntityManager) => {
        const lockedTrade = await manager.findOne(Trade, {
          where: { id: tradeId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!lockedTrade) {
          throw new NotFoundException('Trade not found.');
        }

        if (lockedTrade.status === TradeStatus.COMPLETED) {
          return {
            success: true,
            tradeId,
            status: TradeStatus.COMPLETED,
            txHash: lockedTrade.txHash,
          };
        }

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

        lockedTrade.status = TradeStatus.COMPLETED;
        lockedTrade.txHash = txHash.toLowerCase();
        lockedTrade.settlementMode = SettlementMode.ON_CHAIN;
        const savedTrade = await manager.save(Trade, lockedTrade);

        await manager.update(
          SecondaryMarketListing,
          { id: trade.listingId },
          { status: ListingStatus.SOLD },
        );

        await this.auditService.log(
          {
            adminId: trade.buyer.user.id,
            targetId: savedTrade.id,
            action: AdminAction.TRADE_COMPLETED,
            reason: `On-chain atomic trade intent verified successfully (TX: ${txHash})`,
          },
          manager,
        );

        return {
          success: true,
          tradeId,
          status: TradeStatus.COMPLETED,
          txHash,
        };
      },
    );
  }

  // =========================================================
  // 4. LIVE STATUS POLLING
  // =========================================================
  async getLiveStatus(tradeId: string, userId: string) {
    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId },
      relations: ['buyer', 'buyer.user', 'seller', 'seller.user', 'asset'],
    });

    if (!trade) {
      throw new NotFoundException('Trade record not found.');
    }

    if (trade.buyer?.user?.id !== userId && trade.seller?.user?.id !== userId) {
      throw new ForbiddenException('Unauthorized to view this trade status.');
    }

    return trade;
  }

  // =========================================================
  // 5. LEGACY/FALLBACK EXECUTE & INDEXER SYNC METHODS
  // =========================================================
  async executeTrade(
    listingId: string,
    buyer: InvestorProfile,
    settlementMode: 'OFF_CHAIN' | 'ON_CHAIN' = 'OFF_CHAIN',
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
            const asset = await manager.findOne(Asset, {
              where: { id: listing.assetId },
            });
            if (!asset) throw new NotFoundException('Asset not found');

            const stablecoinAddress = this.configService.get<string>(
              'NEXT_PUBLIC_STABLECOIN_ADDRESS',
            )!;
            const marketplaceAddress =
              this.blockchainService.getMarketplaceAddress();

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

            const trade = manager.create(Trade, {
              buyer,
              seller: sellerProfile,
              listingId: listing.id,
              asset: { id: listing.assetId } as any,
              units: Number(listing.unitsForSale),
              pricePerUnit: listing.pricePerUnit,
              totalPrice,
              status: TradeStatus.LOCKED,
              settlementMode: SettlementMode.ON_CHAIN,
              executedAt: new Date(),
            });

            const savedTrade = await manager.save(trade);

            listing.status = ListingStatus.PENDING;
            await manager.save(listing);

            await this.auditService.log(
              {
                adminId: buyer.user.id,
                targetId: savedTrade.id,
                action: AdminAction.TRADE_COMPLETED,
                reason: `On-chain intent trade initialized, awaiting transaction submission.`,
              },
              manager,
            );

            return savedTrade;
          } else {
            const buyerBalance = await this.walletService.getBalance(
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
              settlementMode: SettlementMode.OFF_CHAIN,
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

  async syncOnChainTrade(
    listingId: string,
    buyer: InvestorProfile,
    txHash: string,
  ): Promise<Trade> {
    return await this.tradeRepo.manager.transaction(
      async (manager: EntityManager) => {
        let trade = await manager.findOne(Trade, {
          where: { listingId, status: TradeStatus.PENDING },
          relations: ['seller', 'buyer', 'asset'],
          lock: { mode: 'pessimistic_write' },
        });

        const listing = await manager
          .getRepository(SecondaryMarketListing)
          .createQueryBuilder('listing')
          .setLock('pessimistic_write')
          .where('listing.id = :listingId', { listingId })
          .getOne();

        if (!listing) {
          throw new NotFoundException('Listing not found');
        }

        const totalPrice =
          Number(listing.unitsForSale) * Number(listing.pricePerUnit);
        const sellerProfile = await this.ownershipService.getInvestorByUserId(
          listing.sellerId,
        );

        if (!trade) {
          trade = manager.create(Trade, {
            buyer,
            seller: sellerProfile,
            listingId: listing.id,
            asset: { id: listing.assetId } as any,
            units: Number(listing.unitsForSale),
            pricePerUnit: listing.pricePerUnit,
            totalPrice,
            status: TradeStatus.PENDING,
            settlementMode: SettlementMode.ON_CHAIN,
            executedAt: new Date(),
          });
          trade = await manager.save(Trade, trade);
        }

        trade.status = TradeStatus.COMPLETED;
        trade.txHash = txHash;
        trade.settlementMode = SettlementMode.ON_CHAIN;
        const savedTrade = await manager.save(Trade, trade);

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
        await manager.save(SecondaryMarketListing, listing);

        await this.auditService.log(
          {
            adminId: buyer.user.id,
            targetId: savedTrade.id,
            action: AdminAction.TRADE_COMPLETED,
            reason: `On-chain atomic trade synced successfully via indexer (TX: ${txHash})`,
          },
          manager,
        );

        return savedTrade;
      },
    );
  }

  async settleTrade(tradeId: string, currentUserId: string): Promise<Trade> {
    return await this.settlementMutex.runExclusive(async () => {
      const trade = await this.tradeRepo.findOne({
        where: { id: tradeId },
        relations: ['seller', 'seller.user', 'buyer', 'buyer.user', 'asset'],
      });

      if (!trade || trade.buyer.user.id !== currentUserId)
        throw new BadRequestException('Unauthorized or trade not found');
      if (
        trade.status !== TradeStatus.LOCKED &&
        trade.status !== TradeStatus.PENDING
      )
        throw new BadRequestException(
          `Cannot settle trade in ${trade.status} status`,
        );

      const receipt = await this.blockchainService.settleTrade(
        trade.listingId,
        trade.seller.user.walletAddress!,
        trade.buyer.user.walletAddress!,
        trade.units.toString(),
      );

      return await this.tradeRepo.manager.transaction(async (manager) => {
        const txTrade = await manager.findOne(Trade, {
          where: { id: tradeId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!txTrade) throw new Error('Trade not found.');

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
        txTrade.settlementMode = SettlementMode.OFF_CHAIN;
        await manager.save(Trade, txTrade);

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
            reason: `Off-chain trade escrow settlement finalized on-chain (TX: ${receipt.hash}).`,
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
        { buyer: { user: { id: userId } }, status: TradeStatus.PENDING },
        { seller: { user: { id: userId } }, status: TradeStatus.PENDING },
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
    if (
      trade.status !== TradeStatus.LOCKED &&
      trade.status !== TradeStatus.PENDING
    )
      throw new BadRequestException(
        'Only LOCKED or PENDING trades can be disputed.',
      );
    return trade;
  }
}
