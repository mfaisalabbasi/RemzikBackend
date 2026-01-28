import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { ListingService } from './listing.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
@Controller('secondary-market/listings')
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateListingDto) {
    return this.listingService.createListing(userId, dto);
  }

  @Get('asset/:assetId')
  getByAsset(@Param('assetId') assetId: string) {
    return this.listingService.getActiveListingsByAsset(assetId);
  }

  @Delete(':id')
  cancel(@CurrentUser('id') userId: string, @Param('id') listingId: string) {
    return this.listingService.cancelListing(listingId, userId);
  }
}
