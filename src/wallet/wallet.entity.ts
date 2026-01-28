import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;
  @Column({ type: 'decimal', default: 0 })
  lockedBalance: number; // ✅ add this

  @Column('decimal', { precision: 15, scale: 2, default: 0 })
  balance: number;
  @Column({ type: 'decimal', default: 0 })
  availableBalance: number;
}
