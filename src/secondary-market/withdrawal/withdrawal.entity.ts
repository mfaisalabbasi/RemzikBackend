import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { WithdrawalStatus } from './enums/withdrawal-status.enum';
import { WithdrawalMethod } from './enums/withdrawal-method.enum';
@Entity('withdrawals')
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('decimal', { precision: 18, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: WithdrawalMethod,
  })
  method: WithdrawalMethod;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PENDING,
  })
  status: WithdrawalStatus;

  @Column({ nullable: true })
  destination: string; // IBAN / wallet address

  @CreateDateColumn()
  createdAt: Date;
}
