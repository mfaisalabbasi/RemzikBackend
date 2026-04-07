import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { InvestorProfile } from '../../investor/investor.entity';
import { Asset } from '../../asset/asset.entity';
import { TradeStatus } from './enums/trade-status.enum';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InvestorProfile, { nullable: true })
  @Index() // Added index for faster dashboard lookups
  buyer: InvestorProfile;

  @ManyToOne(() => InvestorProfile, { nullable: false })
  @Index()
  seller: InvestorProfile;

  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  @Column('int')
  units: number;

  @Column('decimal', { precision: 18, scale: 4 })
  pricePerUnit: number;

  @Column('decimal', { precision: 18, scale: 4 })
  totalPrice: number;

  @Column({
    type: 'enum',
    enum: TradeStatus,
    default: TradeStatus.PENDING,
  })
  status: TradeStatus;

  @Column({ type: 'timestamp', nullable: true })
  executedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
