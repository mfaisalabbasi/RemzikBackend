import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DisputeStatus, DisputeType } from './dispute.enums';
import { Trade } from 'src/secondary-market/trade/trade.entity';

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // who raised the dispute (investor / partner)
  @Column()
  userId: string;

  // optional: admin assigned later
  @Column({ nullable: true })
  adminId?: string;

  // what kind of dispute
  @Column({
    type: 'enum',
    enum: DisputeType,
  })
  type: DisputeType;

  // reference id (investmentId / payoutId / tradeId)
  @Column()
  referenceId: string;

  @ManyToOne(() => Trade)
  @JoinColumn({ name: 'referenceId' }) // Tells TypeORM this ID links to Trade
  trade: Trade;

  // dispute explanation
  @Column('text')
  reason: string;

  // admin resolution note
  @Column('text', { nullable: true })
  resolutionNote?: string;

  @Column({
    type: 'enum',
    enum: DisputeStatus,
    default: DisputeStatus.OPEN,
  })
  status: DisputeStatus;

  @Column({ nullable: true })
  adminNote?: string;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
