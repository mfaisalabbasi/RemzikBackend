import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

import { PartnerProfile } from 'src/partner/partner.entity';
import { AssetType } from './enums/asset-type.enum';
import { AssetStatus } from './enums/asset-status.enum';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';
import { AssetIncome } from './asset-income.entity';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Partner who submitted the asset
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
   * Asset valuation (Currency: Scale 2)
   */
  @Column('decimal', {
    precision: 15,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  totalValue!: number;

  /**
   * ✅ NEW: Fixed price per individual token (Currency: Scale 2)
   */
  @Column('decimal', {
    precision: 15,
    scale: 2,
    default: 0,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  unitPrice!: number;

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
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  expectedYield!: number | null;

  /**
   * Annual rental income
   */
  @Column('decimal', {
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  rentalIncome!: number | null;

  /**
   * Property size
   */
  @Column('decimal', {
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  assetSize!: number | null;

  /**
   * Token supply for fractionalization
   */
  @OneToOne(() => AssetToken, (token) => token.asset)
  token?: AssetToken;

  /**
   * ✅ FIX: Precision Update
   * Changed from bigint to decimal(20,4) to allow fractional share math
   * and avoid JavaScript integer overflow on multi-billion dollar supplies.
   */
  @Column('decimal', {
    precision: 20,
    scale: 4,
    nullable: true,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v ? parseFloat(v) : null),
    },
  })
  tokenSupply!: number | null;

  /**
   * Total money raised (Currency: Scale 2)
   */
  @Column('decimal', {
    precision: 15,
    scale: 2,
    default: 0,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
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

  /**
   * Relationship to Asset Performance Reports
   */
  @OneToMany(() => AssetIncome, (income) => income.asset)
  incomes!: AssetIncome[];
}
