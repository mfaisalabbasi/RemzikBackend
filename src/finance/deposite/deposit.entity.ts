import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum DepositStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('deposits')
export class Deposit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  userId!: string;

  @Column('decimal', { precision: 18, scale: 2 })
  amount!: number;

  @Column({ nullable: true })
  provider!: string; // e.g., 'MOYASAR', 'BANK_TRANSFER'

  @Column({ nullable: true })
  referenceId!: string; // External transaction ID

  @Column({ type: 'enum', enum: DepositStatus, default: DepositStatus.PENDING })
  status!: DepositStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
