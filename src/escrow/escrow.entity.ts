import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { EscrowStatus } from './enums/escrow-status.enum';

@Entity('escrows')
export class Escrow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tradeId: string;

  @Column()
  buyerId: string;

  @Column()
  sellerId: string;

  @Column('decimal', { precision: 18, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: EscrowStatus,
    default: EscrowStatus.LOCKED,
  })
  status: EscrowStatus;

  @Column({ type: 'timestamp' })
  releaseAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
