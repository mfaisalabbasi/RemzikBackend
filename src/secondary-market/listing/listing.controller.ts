import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  UseGuards,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ListingService } from './listing.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';

@UseGuards(JwtAuthGuard)
@Controller('secondary-market/listings')
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  /**
   * CREATE A NEW LISTING
   * Post a "Sell Order" to the market.
   */
  @Post()
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateListingDto,
  ) {
    if (!userId) throw new BadRequestException('User session required');
    return this.listingService.createListing(userId, dto);
  }

  /**
   * GET ACTIVE LISTINGS BY ASSET
   * Used for the "Order Book" table on your SecondaryMarketPage.tsx.
   * Example: /secondary-market/listings/asset/uuid-here
   */
  @Get('asset/:assetId')
  async getByAsset(@Param('assetId') assetId: string) {
    return this.listingService.getActiveListingsByAsset(assetId);
  }

  /**
   * GET MY ACTIVE LISTINGS
   * Used for the "My Positions" or "Active Orders" section.
   * Allows the user to see what they currently have for sale.
   */
  @Get('my-listings')
  async getMyListings(@CurrentUser('userId') userId: string) {
    return this.listingService.getListingsBySeller(userId);
  }

  /**
   * GET ALL GLOBAL ACTIVE LISTINGS
   * Useful for a general "Browse Market" page.
   */
  @Get('all')
  async getAllActive() {
    return this.listingService.getAllActiveListings();
  }

  /**
   * CANCEL A LISTING
   * Removes the offer from the market and "unlocks" the user's units.
   */
  @Delete(':id')
  async cancel(
    @CurrentUser('userId') userId: string,
    @Param('id') listingId: string,
  ) {
    return this.listingService.cancelListing(listingId, userId);
  }

  /**
   * GET LISTING DETAILS
   * Fetches specific metadata for a single listing ID.
   */
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.listingService.getListingById(id);
  }
}
