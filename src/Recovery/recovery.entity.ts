// src/recovery/entities/recovery.entity.ts
import { User } from 'src/user/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinColumn,
} from 'typeorm';

export enum RecoveryStatus {
  PENDING_DOCUMENTS = 'PENDING_DOCUMENTS',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  WALLET_CREATED = 'WALLET_CREATED',
  PROCESSING_BLOCKCHAIN = 'PROCESSING_BLOCKCHAIN',
  WAITING_LOGIN = 'WAITING_LOGIN',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

@Entity('recovery_requests')
export class RecoveryRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column()
  oldWallet!: string;

  @Column({ nullable: true })
  newWallet!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'simple-array', nullable: true })
  documentUrls!: string[];

  @Column({
    type: 'enum',
    enum: RecoveryStatus,
    default: RecoveryStatus.PENDING_DOCUMENTS,
  })
  status!: RecoveryStatus;

  @Column({ nullable: true })
  txHash!: string;
  @ManyToMany(() => User, (user) => user.recoveryRequests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
  @Column({ nullable: true })
  completedAt!: Date;
}
