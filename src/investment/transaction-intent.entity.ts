import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IntentStatus {
  AWAITING_SIGNATURE = 'AWAITING_SIGNATURE',
  BROADCAST = 'BROADCAST',
  CONFIRMED = 'CONFIRMED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

@Entity('transaction_intents')
export class TransactionIntent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  investmentId: string;

  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar' })
  walletAddress: string;

  @Column({ type: 'int' })
  chainId: number;

  @Column({ type: 'varchar' })
  targetContract: string;

  @Column({ type: 'text' })
  encodedCalldata: string;

  @Column({ type: 'varchar' })
  valueWei: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  expectedAmount: number;

  @Column({ type: 'varchar' })
  expectedToken: string;

  @Column({
    type: 'enum',
    enum: IntentStatus,
    default: IntentStatus.AWAITING_SIGNATURE,
  })
  status: IntentStatus;

  @Column({ type: 'varchar', nullable: true })
  txHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
