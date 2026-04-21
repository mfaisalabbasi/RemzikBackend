import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { BroadcastTarget } from './enums/broadcast-target.enum';

@Entity('broadcasts')
export class Broadcast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Index()
  @Column({ type: 'enum', enum: BroadcastTarget, default: BroadcastTarget.ALL })
  target: BroadcastTarget;

  @Index()
  @Column()
  adminId: string;

  @CreateDateColumn()
  createdAt: Date;
}
