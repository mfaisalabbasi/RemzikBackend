import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ListingStatus } from './enums/listing-status.enum';

@Entity('secondary_market_listings')
export class SecondaryMarketListing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  assetId: string;

  @Column()
  sellerId: string;

  @Column('decimal', { precision: 18, scale: 6 })
  unitsForSale: number;

  @Column('decimal', { precision: 18, scale: 2 })
  pricePerUnit: number;

  @Column({
    type: 'enum',
    enum: ListingStatus,
    default: ListingStatus.ACTIVE,
  })
  status: ListingStatus;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
