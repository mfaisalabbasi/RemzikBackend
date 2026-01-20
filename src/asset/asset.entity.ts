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
  id: string;

  /**
   * Who owns / submits this asset
   */
  @ManyToOne(() => PartnerProfile, { nullable: false })
  partner: PartnerProfile;

  /**
   * Asset category
   */
  @Column({
    type: 'enum',
    enum: AssetType,
  })
  type: AssetType;

  /**
   * Human readable title
   */
  @Column()
  title: string;

  /**
   * Real estate specific (generic for now)
   */
  @Column('text')
  description: string;

  /**
   * Asset valuation (SAR, USD later configurable)
   */
  @Column('decimal', { precision: 15, scale: 2 })
  totalValue: number;

  /**
   * Compliance / lifecycle state
   */
  @Column({
    type: 'enum',
    enum: AssetStatus,
    default: AssetStatus.DRAFT,
  })
  status: AssetStatus;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
