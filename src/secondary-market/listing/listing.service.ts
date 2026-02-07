import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecondaryMarketListing } from './listing.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { OwnershipService } from '../../ownership/ownership.service';
import { ListingStatus } from './enums/listing-status.enum';

@Injectable()
export class ListingService {
  constructor(
    @InjectRepository(SecondaryMarketListing)
    private readonly listingRepo: Repository<SecondaryMarketListing>,
    private readonly ownershipService: OwnershipService,
  ) {}

  /**
   * Create a secondary market listing
   */
  async createListing(
    sellerId: string, // ✅ MUST be UUID string
    dto: CreateListingDto,
  ): Promise<SecondaryMarketListing> {
    if (!sellerId) {
      throw new BadRequestException('Invalid seller id');
    }

    // 1️⃣ Check ownership
    const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
      sellerId,
      dto.assetId,
    );
    if (ownedUnits < dto.unitsForSale) {
      throw new BadRequestException(
        `Insufficient units. You own ${ownedUnits} units.`,
      );
    }

    // 2️⃣ Create listing
    const listing = this.listingRepo.create({
      sellerId,
      assetId: dto.assetId,
      unitsForSale: dto.unitsForSale,
      pricePerUnit: dto.pricePerUnit,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      status: ListingStatus.ACTIVE,
    });

    // 3️⃣ Save
    return this.listingRepo.save(listing);
  }

  /**
   * Get active listings by asset
   */
  async getActiveListingsByAsset(assetId: string) {
    return this.listingRepo.find({
      where: {
        assetId,
        status: ListingStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Cancel listing
   */
  async cancelListing(listingId: string, sellerId: string) {
    const listing = await this.listingRepo.findOne({
      where: { id: listingId },
    });

    if (!listing) {
      throw new BadRequestException('Listing not found');
    }

    if (listing.sellerId !== sellerId) {
      throw new BadRequestException('Unauthorized action');
    }

    listing.status = ListingStatus.CANCELLED;
    return this.listingRepo.save(listing);
  }
}
