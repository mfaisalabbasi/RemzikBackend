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

  async createListing(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<SecondaryMarketListing> {
    // 1️⃣ Check seller ownership
    const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
      sellerId,
      dto.assetId,
    );

    if (ownedUnits < dto.unitsForSale) {
      throw new BadRequestException('Insufficient units to create listing');
    }

    // 2️⃣ Create listing entity
    const listing = this.listingRepo.create({
      sellerId,
      assetId: dto.assetId,
      unitsForSale: dto.unitsForSale,
      pricePerUnit: dto.pricePerUnit,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      status: ListingStatus.ACTIVE,
    });

    // 3️⃣ Save to DB
    return this.listingRepo.save(listing);
  }

  async getActiveListingsByAsset(assetId: string) {
    return this.listingRepo.find({
      where: {
        assetId,
        status: ListingStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

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
