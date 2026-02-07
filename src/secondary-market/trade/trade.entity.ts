import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvestorProfile } from '../../investor/investor.entity';
import { Asset } from '../../asset/asset.entity';
import { TradeStatus } from './enums/trade-status.enum';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Buyer of the trade.
   * Nullable because trade is created first without a buyer.
   */
  @ManyToOne(() => InvestorProfile, { nullable: true })
  buyer: InvestorProfile;

  /**
   * Seller of the trade.
   * Cannot be null, must exist at trade creation.
   */
  @ManyToOne(() => InvestorProfile, { nullable: false })
  seller: InvestorProfile;

  /**
   * Asset being traded
   */
  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  /**
   * Number of units being traded
   */
  @Column('int')
  units: number;

  /**
   * Price per unit
   */
  @Column('decimal', { precision: 18, scale: 4 })
  pricePerUnit: number;

  /**
   * Total price = units * pricePerUnit
   */
  @Column('decimal', { precision: 18, scale: 4 })
  totalPrice: number;

  /**
   * Trade status: PENDING or COMPLETED
   */
  @Column({ type: 'enum', enum: TradeStatus, default: TradeStatus.PENDING })
  status: TradeStatus;

  /**
   * When trade was executed
   */
  @Column({ type: 'timestamp', nullable: true })
  executedAt: Date;

  /**
   * Timestamps for record keeping
   */
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
