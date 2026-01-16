import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Ownership } from 'src/tokenization/entities/ownershipt.entity';
import { PayoutStatus } from '../enum/payout-status.enum';
import { Revenue } from './revenue.entity';

@Entity('payouts')
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Revenue, { eager: true })
  revenue: Revenue;

  @ManyToOne(() => Ownership, { eager: true })
  ownership: Ownership;

  @Column('decimal', { precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.PENDING })
  status: PayoutStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  paidAt?: Date;
}
