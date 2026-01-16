import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Revenue } from './distribution.entity';
import { User } from 'src/user/user.entity';
import { PayoutStatus } from '../enums/payout-status.enum';

@Entity('payouts')
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Revenue, { eager: true })
  revenue: Revenue;

  @ManyToOne(() => User, { eager: true })
  user: User;

  @Column('decimal')
  ownershipPercentage;

  @Column('decimal')
  amount;

  @Column({ type: 'enum', enum: PayoutStatus })
  status: PayoutStatus;

  @CreateDateColumn()
  createdAt: Date;
}
