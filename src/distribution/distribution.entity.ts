import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { InvestorProfile } from 'src/investor/investor.entity';
import { PayoutStatus } from './enums/payout-status.enum';

// distribution.entity.ts
@Entity('distributions')
export class Distribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Asset, { nullable: false })
  asset!: Asset;

  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor!: InvestorProfile;

  @Column('decimal', { precision: 18, scale: 2 })
  amount!: number;

  @Column()
  period!: string; // e.g., "Q1-2026"

  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.PENDING })
  status!: PayoutStatus;

  @Column({ nullable: true })
  batchId!: string; // Groups all payouts for one event (e.g., "RENT-JUNE-2026")

  @CreateDateColumn()
  createdAt!: Date;
}
