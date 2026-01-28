import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { PayoutStatus } from './enums/payout-status.enum';

@Entity('payouts')
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false })
  investor: User;

  @Column('decimal', { precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.REQUESTED })
  status: PayoutStatus;

  @Column({ type: 'text', nullable: true })
  note?: string;
  //secondary marekt updates
  @Column()
  userId: string; // seller

  @Column()
  referenceId: string; // tradeId

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
