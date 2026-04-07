import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AdminAction } from './enums/audit-action.enum';
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index() // Speed up searches for specific users/admins
  @Column()
  adminId!: string;

  @Index()
  @Column()
  targetId!: string;

  @Column({ type: 'enum', enum: AdminAction })
  action!: AdminAction;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
