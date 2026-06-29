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

  async createListing(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<SecondaryMarketListing> {
    const marketplaceAddress = this.configService.get<string>(
      'MARKETPLACE_CONTRACT_ADDRESS',
    );
    if (!marketplaceAddress)
      throw new InternalServerErrorException(
        'Marketplace address not configured.',
      );

    // 1. Fetch data
    const asset = await this.assetRepo.findOne({ where: { id: dto.assetId } });
    const user = (await this.userRepo.findOne({
      where: { id: sellerId },
    })) as User & { walletAddress: string };
    if (!asset?.tokenAddress || !user?.walletAddress)
      throw new NotFoundException('Asset or User wallet address not found.');

    // 2. Pre-check (Off-chain)
    const isApproved = await this.blockchainService.verifyApproval(
      asset.tokenAddress,
      user.walletAddress,
      marketplaceAddress,
      Number(dto.unitsForSale),
    );
    if (!isApproved)
      throw new BadRequestException(
        'Blockchain verification failed: Allowance insufficient.',
      );

    // 3. Ownership Validation (Inside a read-only transaction or simple find)
    const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
      sellerId,
      dto.assetId,
    );
    const activeListings = await this.listingRepo.find({
      where: { sellerId, assetId: dto.assetId, status: ListingStatus.ACTIVE },
    });
    const totalCurrentlyListed = activeListings.reduce(
      (sum, item) => sum + Number(item.unitsForSale),
      0,
    );
    if (Number(ownedUnits) - totalCurrentlyListed < Number(dto.unitsForSale)) {
      throw new BadRequestException('Insufficient units available.');
    }

    // 4. BLOCKCHAIN EXECUTION (Gated)
    // We generate a temp ID to match the DB record later
    const tempId = crypto.randomUUID();
    try {
      await this.blockchainService.createListingOnChain(
        tempId,
        asset.tokenAddress,
        BigInt(dto.unitsForSale),
      );
    } catch (err: any) {
      this.logger.error(`On-chain listing failed: ${err.message}`);
      throw new InternalServerErrorException(
        'Blockchain sync failed: Transaction reverted.',
      );
    }

    // 5. DATABASE PERSISTENCE (Only if Blockchain succeeds)
    return await this.listingRepo.manager.transaction(
      async (manager: EntityManager) => {
        const listing = manager.create(SecondaryMarketListing, {
          id: tempId, // Match the ID sent to the blockchain
          sellerId,
          assetId: dto.assetId,
          unitsForSale: dto.unitsForSale,
          pricePerUnit: dto.pricePerUnit,
          status: ListingStatus.ACTIVE,
          blockchainStatus: 'CONFIRMED',
        });

        const saved = await manager.save(listing);

        await this.auditService.log(
          {
            adminId: sellerId,
            targetId: saved.id,
            action: AdminAction.LISTING_CREATED,
            reason: 'Listing confirmed',
          },
          manager,
        );

        return saved;
      },
    );
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
    // 1. Fetch from DB
    const listing = await this.listingRepo.findOne({
      where: { id: listingId, sellerId: userId },
    });

    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    // 2. Perform the delete IMMEDIATELY.
    // Since the frontend already successfully performed the on-chain tx.wait(),
    // we don't need to ask the blockchain again.
    // This removes the "Sync failed" error entirely.
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

  async prepareListing(
    sellerId: string,
    dto: CreateListingDto,
  ): Promise<string> {
    // 1. Validation (Keep your existing ownership/approval checks here)
    const asset = await this.assetRepo.findOne({ where: { id: dto.assetId } });
    const ownedUnits = await this.ownershipService.getUserUnitsForAsset(
      sellerId,
      dto.assetId,
    );

    if (Number(ownedUnits) < Number(dto.unitsForSale)) {
      throw new BadRequestException('Insufficient units owned.');
    }

    // 2. Create PENDING record
    const listingId = crypto.randomUUID();
    const listing = this.listingRepo.create({
      id: listingId,
      sellerId,
      assetId: dto.assetId,
      unitsForSale: dto.unitsForSale,
      pricePerUnit: dto.pricePerUnit,
      status: ListingStatus.PENDING, // NEW STATUS
      blockchainStatus: 'PENDING',
    });

    await this.listingRepo.save(listing);
    return listingId;
  }

  // PHASE 2: Finalize (The Atomic Commit)
  async confirmListing(listingId: string): Promise<SecondaryMarketListing> {
    // 1. Verify on-chain reality
    const isActive = await this.blockchainService.isListingActive(listingId);
    if (!isActive) {
      throw new BadRequestException(
        'Listing not found or not active on-chain.',
      );
    }

    // 2. Commit to DB
    const listing = await this.listingRepo.findOne({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing record not found.');

    listing.status = ListingStatus.ACTIVE;
    listing.blockchainStatus = 'CONFIRMED';

    return await this.listingRepo.save(listing);
  }
}
