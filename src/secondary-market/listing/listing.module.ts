import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecondaryMarketListing } from './listing.entity';
import { ListingService } from './listing.service';
import { ListingController } from './listing.controller';
import { OwnershipModule } from '../../ownership/ownership.module';
import { User } from 'src/user/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SecondaryMarketListing, User]),
    OwnershipModule,
  ],
  providers: [ListingService],
  controllers: [ListingController],
  exports: [ListingService],
})
export class ListingModule {}
