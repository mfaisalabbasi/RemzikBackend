import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/user.entity';
import { Investment } from '../../investment/investment.entity';

export enum TradeStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity()
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  buyer: User;

  @ManyToOne(() => User)
  seller: User;

  @ManyToOne(() => Investment)
  investment: Investment;

  @Column('decimal', { precision: 18, scale: 2 })
  price: number;

  @Column({ type: 'enum', enum: TradeStatus, default: TradeStatus.PENDING })
  status: TradeStatus;

  @Column()
  executedAt: Date; // ✅ must exist

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
