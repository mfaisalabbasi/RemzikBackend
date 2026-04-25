import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PartnerProfile } from 'src/partner/partner.entity';
import { AssetType } from './enums/asset-type.enum';
import { AssetStatus } from './enums/asset-status.enum';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Partner who submitted the asset
   * Merged: Added (partner) => partner.assets to enable TypeORM joins
   */
  @ManyToOne(() => PartnerProfile, (partner) => partner.assets, {
    nullable: false,
  })
  partner!: PartnerProfile;

  /**
   * Asset category
   */
  @Column({
    type: 'enum',
    enum: AssetType,
  })
  type!: AssetType;

  /**
   * Asset title
   */
  @Column()
  title!: string;

  /**
   * Description
   */
  @Column('text')
  description!: string;

  /**
   * Asset valuation
   */
  @Column('decimal', { precision: 15, scale: 2 })
  totalValue!: number;

  /**
   * Property gallery images
   */
  @Column('text', { array: true, nullable: true })
  galleryImages!: string[];

  /**
   * Legal ownership documents
   */
  @Column('text', { array: true, nullable: true })
  legalDocuments!: string[];

  /**
   * Financial / valuation reports
   */
  @Column('text', { array: true, nullable: true })
  financialDocuments!: string[];

  /**
   * Other supporting documents
   */
  @Column('text', { array: true, nullable: true })
  otherDocuments!: string[];

  /**
   * Lifecycle status
   */
  @Column({
    type: 'enum',
    enum: AssetStatus,
    default: AssetStatus.SUBMITTED,
  })
  status!: AssetStatus;

  /**
   * Admin rejection reason
   */
  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  /**
   * Property location
   */
  @Column({ type: 'text', nullable: true })
  location!: string | null;

  /**
   * Expected yearly yield %
   */
  @Column('decimal', {
    precision: 5,
    scale: 2,
    nullable: true,
  })
  expectedYield!: number | null;

  /**
   * Annual rental income
   */
  @Column('decimal', {
    precision: 15,
    scale: 2,
    nullable: true,
  })
  rentalIncome!: number | null;

  /**
   * Property size
   */
  @Column('decimal', {
    precision: 10,
    scale: 2,
    nullable: true,
  })
  assetSize!: number | null;

  /**
   * Token supply for fractionalization
   */
  @Column('bigint', { nullable: true })
  tokenSupply!: number | null;

  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  funded!: number;

  /**
   * Count of unique investors
   */
  @Column('int', { default: 0 })
  investors!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
