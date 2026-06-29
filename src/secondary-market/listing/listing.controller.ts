import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  UseGuards,
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
   * PHASE 1: Prepare Listing
   * Creates a 'PENDING' record and returns a listingId.
   */
  @Post('prepare')
  async prepare(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateListingDto,
  ) {
    if (!userId) throw new BadRequestException('User session required');
    const listingId = await this.listingService.prepareListing(userId, dto);
    return { listingId };
  }

  /**
   * PHASE 2: Confirm Listing
   * Validates on-chain reality and moves record to 'ACTIVE'.
   */
  @Post('confirm')
  async confirm(@Body('listingId') listingId: string) {
    return await this.listingService.confirmListing(listingId);
  }

  @Get('asset/:assetId')
  async getByAsset(@Param('assetId') assetId: string) {
    return this.listingService.getActiveListingsByAsset(assetId);
  }

  @Get('my-listings')
  async getMyListings(@CurrentUser('userId') userId: string) {
    return this.listingService.getListingsBySeller(userId);
  }

  @Get('all')
  async getAllActive() {
    return this.listingService.getAllActiveListings();
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.listingService.getListingById(id);
  }

  @Delete(':id')
  async cancel(
    @CurrentUser('userId') userId: string,
    @Param('id') listingId: string,
  ) {
    // This will now execute instantly without blockchain verification delays
    await this.listingService.cancelListing(listingId, userId);
    return { success: true };
  }
}
