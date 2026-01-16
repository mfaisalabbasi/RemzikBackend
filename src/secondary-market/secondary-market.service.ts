import { BadRequestException, Injectable } from '@nestjs/common';
import { ListingStatus } from './enums/listing-status.enum';
import { TransferStatus } from './enums/transfer-status.enum';
import { Repository } from 'typeorm';
import { Transfer } from './entities/transfer.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Listing } from './entities/listing.entity';
import { TokenizationService } from 'src/tokenization/tokenization.service';

@Injectable()
export class SecondaryMarketService {
  constructor(
    private tokenizationService: TokenizationService,
    @InjectRepository(Listing)
    private listingRepo: Repository<Listing>,
    @InjectRepository(Transfer)
    private transferRepo: Repository<Transfer>,
  ) {}

  // Create Listing (SELL)

  async createListing(
    sellerId: string,
    assetId: string,
    percentage: number,
    price: number,
  ) {
    // await this.tokenizationService.ensureTransferAllowed(
    //   sellerId,
    //   assetId,
    //   percentage,
    // );

    return this.listingRepo.save({
      asset: { id: assetId },
      seller: { id: sellerId },
      percentageForSale: percentage,
      price,
      status: ListingStatus.ACTIVE,
    });
  }

  // Buy Listing

  async buyListing(listingId: string, buyerId: string) {
    const listing = await this.listingRepo.findOne({
      where: { id: listingId },
    });

    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Listing unavailable');
    }

    const transfer = await this.transferRepo.save({
      listing,
      buyer: { id: buyerId },
      percentageTransferred: listing.percentageForSale,
      status: TransferStatus.PENDING,
    });

    // await this.tokenizationService.transferOwnership(
    //   listing.seller.id,
    //   buyerId,
    //   listing.asset.id,
    //   listing.percentageForSale,
    // );

    listing.status = ListingStatus.SOLD;
    await this.listingRepo.save(listing);

    // transfer.status = TransferStatus.COMPLETED;
    await this.transferRepo.save(transfer);

    return transfer;
  }

  //STEP 5: LOCKUP RULES (IN TOKENIZATION ENGINE)

  ensureTransferAllowed(userId: string, assetId: string, percentage: number) {
    // 1. Lockup period
    // 2. Minimum holding
    // 3. KYC status
    // 4. Asset transfer rules
  }
}
