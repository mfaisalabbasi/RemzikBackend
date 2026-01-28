import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LedgerSource } from './enums/ledger-source.enum';
import { LedgerType } from './enums/ledger-type.enum';

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('decimal', { precision: 15, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  reference?: string;
  @Column({ nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: LedgerType,
  })
  type: LedgerType;

  @Column({
    type: 'enum',
    enum: LedgerSource,
  })
  source: LedgerSource;

  @Column({ type: 'text', nullable: true })
  note?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
