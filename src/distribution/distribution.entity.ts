import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { InvestorProfile } from 'src/investor/investor.entity';

@Entity('distributions')
export class Distribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Asset generating income
   */
  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  /**
   * Investor receiving payout
   */
  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor: InvestorProfile;

  /**
   * Amount paid
   */
  @Column('decimal', { precision: 15, scale: 2 })
  amount: number;

  /**
   * Period reference (e.g. 2025-01)
   */
  @Column()
  period: string;

  /**
   * Paid or not
   */
  @Column({ default: false })
  paid: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
