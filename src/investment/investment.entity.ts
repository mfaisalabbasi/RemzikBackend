import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { InvestmentStatus } from './enums/investment-status.enum';

@Entity('investments')
export class Investment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Who invested
   */
  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor: InvestorProfile;

  /**
   * What asset
   */
  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  /**
   * Amount invested in currency (e.g., SAR)
   */
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  /**
   * ✅ NEW: Quantity of tokens/units purchased
   */
  @Column({
    type: 'int',
    default: 0,
  })
  units: number;

  /**
   * ✅ NEW: Snapshot of the unit price at the time of purchase
   * Essential for historical audits and ROI calculations.
   */
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : null),
    },
  })
  unitPriceAtPurchase: number;

  /**
   * Payment lifecycle
   */
  @Column({
    type: 'enum',
    enum: InvestmentStatus,
    default: InvestmentStatus.PENDING,
  })
  status: InvestmentStatus;

  @CreateDateColumn()
  createdAt: Date;
}
