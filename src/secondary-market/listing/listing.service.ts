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
import { Mutex } from 'async-mutex'; // Import the lock
import { SecondaryMarketListing } from './listing.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { OwnershipService } from '../../ownership/ownership.service';
import { ListingStatus } from './enums/listing-status.enum';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';

@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);
  private readonly listingMutex = new Mutex(); // Central lock for listing operations

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
  ) {}

  async getReservedUnits(userId: string, assetId: string): Promise<number> {
    const activeListings = await this.listingRepo.find({
      where: {
        sellerId: userId,
        assetId: assetId,
        status: ListingStatus.ACTIVE, // or PENDING
      },
    });

    // Sum up all units currently held in listings by this user
    return activeListings.reduce((sum, l) => sum + Number(l.unitsForSale), 0);
  }

  async createListing(
    sellerId: string,
    dto: CreateListingDto,
    txHash: string,
    listingId: string,
  ): Promise<SecondaryMarketListing> {
    return await this.listingMutex.runExclusive(async () => {
      // 1. Verify existence on-chain
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

      // 2. Perform Atomic Database Transaction
      return await this.listingRepo.manager.transaction(
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
    });
  }

  async prepareListing(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<string> {
    // 1. Wrap in Mutex to ensure the check-and-save happens atomically
    return await this.listingMutex.runExclusive(async () => {
      // 2. Get total owned units
      const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
        sellerId,
        dto.assetId,
      );

      // 3. Get units already tied up in existing listings (Active or Pending)
      const existingListings = await this.listingRepo.find({
        where: {
          sellerId: sellerId,
          assetId: dto.assetId,
          status: ListingStatus.ACTIVE, // Or PENDING if you consider those 'locked'
        },
      });

      const reservedUnits = existingListings.reduce(
        (sum, l) => sum + Number(l.unitsForSale),
        0,
      );

      // 4. Calculate actual available units
      const availableUnits = Number(ownedUnits) - reservedUnits;

      if (Number(dto.unitsForSale) > availableUnits) {
        throw new BadRequestException(
          `Insufficient available units. You own ${ownedUnits}, but have ${reservedUnits} units already listed.`,
        );
      }

      // 5. Proceed with creation
      const listingId = crypto.randomUUID();
      const listing = this.listingRepo.create({
        id: listingId,
        sellerId,
        assetId: dto.assetId,
        unitsForSale: dto.unitsForSale,
        pricePerUnit: dto.pricePerUnit,
        status: ListingStatus.PENDING,
        blockchainStatus: 'PENDING',
      });

      await this.listingRepo.save(listing);
      return listingId;
    });
  }

  async confirmListing(listingId: string): Promise<SecondaryMarketListing> {
    return await this.listingMutex.runExclusive(async () => {
      const isActive = await this.blockchainService.isListingActive(listingId);
      if (!isActive)
        throw new BadRequestException(
          'Listing not found or not active on-chain.',
        );

      const listing = await this.listingRepo.findOne({
        where: { id: listingId },
      });
      if (!listing) throw new NotFoundException('Listing record not found.');

      listing.status = ListingStatus.ACTIVE;
      listing.blockchainStatus = 'CONFIRMED';

      return await this.listingRepo.save(listing);
    });
  }

  // --- HELPER METHODS (Unchanged) ---
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
    });
    if (!listing) throw new NotFoundException('Listing not found');

    try {
      await this.listingRepo.delete({ id: listingId });
      this.logger.log(`Listing ${listingId} successfully removed from DB.`);
    } catch (error: any) {
      this.logger.error(
        `Failed to delete listing ${listingId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Database deletion failed.');
    }
  }
}
