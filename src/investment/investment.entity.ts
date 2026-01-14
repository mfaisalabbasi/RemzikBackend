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
   * Amount invested
   */
  @Column('decimal', { precision: 15, scale: 2 })
  amount: number;

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
