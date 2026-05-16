import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { SecondaryMarketListing } from './listing.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { OwnershipService } from '../../ownership/ownership.service';
import { ListingStatus } from './enums/listing-status.enum';
import { AuditService } from 'src/audit/audit.service';
import { AdminAction } from 'src/audit/enums/audit-action.enum';

@Injectable()
export class ListingService {
  constructor(
    @InjectRepository(SecondaryMarketListing)
    private readonly listingRepo: Repository<SecondaryMarketListing>,
    private readonly ownershipService: OwnershipService,
    private readonly auditService: AuditService,
  ) {}

  async createListing(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<SecondaryMarketListing> {
    // 🛡️ RUN INSIDE TRANSACTION TO PREVENT DOUBLE-LISTING RACE CONDITION
    return await this.listingRepo.manager.transaction(
      async (manager: EntityManager) => {
        const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
          sellerId,
          dto.assetId,
        );

        // 🔍 Find all currently active listings by this user for this asset
        const activeListings = await manager.find(SecondaryMarketListing, {
          where: {
            sellerId,
            assetId: dto.assetId,
            status: ListingStatus.ACTIVE,
          },
        });

        const totalCurrentlyListed = activeListings.reduce(
          (sum, item) => sum + Number(item.unitsForSale),
          0,
        );

        const availableLiquidUnits = Number(ownedUnits) - totalCurrentlyListed;

        if (availableLiquidUnits < Number(dto.unitsForSale)) {
          throw new BadRequestException(
            `Insufficient units. You own ${ownedUnits} units, but ${totalCurrentlyListed} are already locked in active listings. Available: ${availableLiquidUnits}`,
          );
        }

        const listing = manager.create(SecondaryMarketListing, {
          sellerId,
          assetId: dto.assetId,
          unitsForSale: dto.unitsForSale,
          pricePerUnit: dto.pricePerUnit,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          status: ListingStatus.ACTIVE,
        });

        const savedListing = await manager.save(listing);

        await this.auditService.log(
          {
            adminId: sellerId,
            targetId: savedListing.id,
            action: AdminAction.LISTING_CREATED,
            reason: `Created listing for ${dto.unitsForSale} units of asset ${dto.assetId}`,
          },
          manager,
        );

        return savedListing;
      },
    );
  }

  // Keep read methods unchanged...
  async getActiveListingsByAsset(
    assetId: string,
  ): Promise<SecondaryMarketListing[]> {
    return this.listingRepo.find({
      where: { assetId, status: ListingStatus.ACTIVE },
      relations: ['asset'],
      order: { pricePerUnit: 'ASC', createdAt: 'ASC' },
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

  async cancelListing(
    listingId: string,
    sellerId: string,
  ): Promise<SecondaryMarketListing> {
    const listing = await this.getListingById(listingId);
    if (listing.sellerId !== sellerId)
      throw new BadRequestException('Unauthorized');
    if (listing.status !== ListingStatus.ACTIVE)
      throw new BadRequestException('Already handled');

    listing.status = ListingStatus.CANCELLED;
    return this.listingRepo.save(listing);
  }
}
