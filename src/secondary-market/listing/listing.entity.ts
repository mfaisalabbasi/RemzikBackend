import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ListingStatus } from './enums/listing-status.enum';
import { Asset } from 'src/asset/asset.entity'; // ✅ Make sure this path is correct

@Entity('secondary_market_listings')
export class SecondaryMarketListing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  assetId: string;

  // ✅ ADD THIS: This links the ID to the actual Asset Entity
  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset: Asset;

  @Index()
  @Column()
  sellerId: string;

  @Column('decimal', { precision: 18, scale: 6 })
  unitsForSale: number;

  @Column('decimal', { precision: 18, scale: 2 })
  pricePerUnit: number;

  @Index()
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
