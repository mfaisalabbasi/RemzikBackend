import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  userId: string;

  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  availableBalance: number;

  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  lockedBalance: number;

  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  pendingBalance: number; // ✅ Added to track payouts securely

  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  totalEarned: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
