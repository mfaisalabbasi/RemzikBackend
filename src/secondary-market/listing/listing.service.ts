import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Mutex } from 'async-mutex';
import { SecondaryMarketListing } from './listing.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { OwnershipService } from '../../ownership/ownership.service';
import { ListingStatus } from './enums/listing-status.enum';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);
  private readonly listingMutex = new Mutex();

  constructor(
    @InjectRepository(SecondaryMarketListing)
    private readonly listingRepo: Repository<SecondaryMarketListing>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    private readonly ownershipService: OwnershipService,
    private readonly auditService: AuditService,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationOrchestrator: NotificationOrchestrator,
  ) {}

  async getReservedUnits(userId: string, assetId: string): Promise<number> {
    const activeListings = await this.listingRepo.find({
      where: {
        sellerId: userId,
        assetId: assetId,
        status: ListingStatus.ACTIVE,
      },
    });

    return activeListings.reduce((sum, l) => sum + Number(l.unitsForSale), 0);
  }

  async createListing(
    sellerId: string,
    dto: CreateListingDto,
    txHash: string,
    listingId: string,
  ): Promise<SecondaryMarketListing> {
    return await this.listingMutex.runExclusive(async () => {
      const isActive = await this.blockchainService.isListingActive(listingId);
      if (!isActive) {
        throw new BadRequestException(
          'Listing not found or not active on-chain.',
        );
      }

      const asset = await this.assetRepo.findOne({
        where: { id: dto.assetId },
      });
      if (!asset) throw new NotFoundException('Asset not found.');

      const savedListing = await this.listingRepo.manager.transaction(
        async (manager: EntityManager) => {
          const listing = manager.create(SecondaryMarketListing, {
            id: listingId,
            sellerId,
            assetId: dto.assetId,
            unitsForSale: dto.unitsForSale,
            pricePerUnit: dto.pricePerUnit,
            status: ListingStatus.ACTIVE,
            blockchainStatus: 'CONFIRMED',
            txHash: txHash,
          });

          const saved = await manager.save(listing);

          await this.auditService.log(
            {
              adminId: sellerId,
              targetId: saved.id,
              action: AdminAction.LISTING_CREATED,
              reason: `Listing confirmed on-chain. TX: ${txHash}`,
            },
            manager,
          );
          return saved;
        },
      );

      // 🛡️ NOTIFICATION: Inform seller listing is active
      try {
        await this.notificationOrchestrator.buildAndSave(
          sellerId,
          'listing.created',
          {
            title: 'Secondary Market Listing Active',
            message: `Your listing for ${dto.unitsForSale} units of "${asset.title}" is now active on the marketplace.`,
            listingId: savedListing.id,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send listing creation notification: ${err}`,
        );
      }

      return savedListing;
    });
  }

  async prepareListing(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<string> {
    return await this.listingMutex.runExclusive(async () => {
      return await this.listingRepo.manager.transaction(async (manager) => {
        await manager
          .createQueryBuilder()
          .delete()
          .from(SecondaryMarketListing)
          .where(
            'sellerId = :sellerId AND assetId = :assetId AND status = :status AND createdAt < :threshold',
            {
              sellerId,
              assetId: dto.assetId,
              status: ListingStatus.PENDING,
              threshold: new Date(Date.now() - 10 * 60 * 1000),
            },
          )
          .andWhere('id NOT IN (SELECT "listingId" FROM "trades")')
          .execute();

        const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
          sellerId,
          dto.assetId,
        );

        const existingListings = await manager.find(SecondaryMarketListing, {
          where: [
            { sellerId, assetId: dto.assetId, status: ListingStatus.ACTIVE },
            { sellerId, assetId: dto.assetId, status: ListingStatus.PENDING },
          ],
          lock: { mode: 'pessimistic_write' },
        });

        const reservedUnits = existingListings.reduce(
          (sum, l) => sum + Number(l.unitsForSale),
          0,
        );

        const availableUnits = Number(ownedUnits) - reservedUnits;

        if (Number(dto.unitsForSale) <= 0) {
          throw new BadRequestException(
            'Units for sale must be greater than zero.',
          );
        }

        if (Number(dto.unitsForSale) > availableUnits) {
          throw new BadRequestException(
            `Insufficient available units. You own ${ownedUnits}, but have ${reservedUnits} units already listed or pending.`,
          );
        }

        const listingId = crypto.randomUUID();
        const listing = manager.create(SecondaryMarketListing, {
          id: listingId,
          sellerId,
          assetId: dto.assetId,
          unitsForSale: dto.unitsForSale,
          pricePerUnit: dto.pricePerUnit,
          status: ListingStatus.PENDING,
          blockchainStatus: 'PENDING',
        });

        await manager.save(listing);
        return listingId;
      });
    });
  }

  async confirmListing(
    listingId: string,
    txHash?: string,
  ): Promise<SecondaryMarketListing> {
    return await this.listingMutex.runExclusive(async () => {
      const isActive = await this.blockchainService.isListingActive(listingId);
      if (!isActive)
        throw new BadRequestException(
          'Listing not found or not active on-chain.',
        );

      const listing = await this.listingRepo.findOne({
        where: { id: listingId },
        relations: ['asset'],
      });
      if (!listing) throw new NotFoundException('Listing record not found.');

      listing.status = ListingStatus.ACTIVE;
      listing.blockchainStatus = 'CONFIRMED';
      if (txHash) {
        listing.txHash = txHash;
      }

      const savedListing = await this.listingRepo.save(listing);

      // 🛡️ NOTIFICATION: Inform seller listing confirmed
      try {
        await this.notificationOrchestrator.buildAndSave(
          listing.sellerId,
          'listing.confirmed',
          {
            title: 'Listing Confirmed',
            message: `Your listing for "${listing.asset?.title || 'Asset'}" has been confirmed on-chain.`,
            listingId: savedListing.id,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send listing confirmation notification: ${err}`,
        );
      }

      return savedListing;
    });
  }

  async getActiveListingsByAsset(
    assetId: string,
  ): Promise<SecondaryMarketListing[]> {
    return this.listingRepo.find({
      where: { assetId, status: ListingStatus.ACTIVE },
      relations: ['asset'],
      order: { pricePerUnit: 'ASC' },
    });
  }

  async getListingsBySeller(
    sellerId: string,
  ): Promise<SecondaryMarketListing[]> {
    return this.listingRepo.find({
      where: { sellerId },
      relations: ['asset'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllActiveListings(): Promise<SecondaryMarketListing[]> {
    return this.listingRepo.find({
      where: { status: ListingStatus.ACTIVE },
      relations: ['asset'],
      order: { createdAt: 'DESC' },
    });
  }

  async getListingById(id: string): Promise<SecondaryMarketListing> {
    const listing = await this.listingRepo.findOne({
      where: { id },
      relations: ['asset'],
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  async cancelListing(listingId: string, userId: string): Promise<void> {
    const listing = await this.listingRepo.findOne({
      where: { id: listingId, sellerId: userId },
      relations: ['asset'],
    });
    if (!listing) throw new NotFoundException('Listing not found');

    try {
      await this.listingRepo.delete({ id: listingId });
      this.logger.log(`Listing ${listingId} successfully removed from DB.`);

      // 🛡️ NOTIFICATION: Inform seller listing cancelled
      try {
        await this.notificationOrchestrator.buildAndSave(
          userId,
          'listing.cancelled',
          {
            title: 'Listing Cancelled',
            message: `Your listing for "${listing.asset?.title || 'Asset'}" has been cancelled successfully.`,
            listingId,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send listing cancellation notification: ${err}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to delete listing ${listingId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Database deletion failed.');
    }
  }
}
