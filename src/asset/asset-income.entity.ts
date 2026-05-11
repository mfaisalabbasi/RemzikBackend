import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Asset } from './asset.entity';

export enum IncomeType {
  RENT = 'RENT',
  DIVIDEND = 'DIVIDEND',
  CAPITAL_GAIN = 'CAPITAL_GAIN',
  OTHER = 'OTHER',
}

@Entity('asset_incomes')
export class AssetIncome {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Reference the Asset entity
  @ManyToOne(() => Asset, (asset) => asset.incomes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset: Asset;

  // Explicit assetId column helps TypeORM map the ID directly from the DTO
  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  grossAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  expenses: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  netAmount: number;

  @Column({ type: 'enum', enum: IncomeType, default: IncomeType.RENT })
  type: IncomeType;

  @Column()
  period: string;

  /**
   * ✅ FIXED: Added documentUrl to match the Frontend/Service requirements
   */
  @Column({ type: 'text', nullable: true })
  documentUrl: string;

  @Column({ type: 'boolean', default: false })
  isDistributed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
