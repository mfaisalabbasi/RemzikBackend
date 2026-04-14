import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from 'src/user/user.entity';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // We keep the string column for easy querying...
  @Column()
  @Index()
  userId: string;

  // ...but we link it to the User entity for database integrity
  @ManyToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  title: string;

  @Column({ nullable: true, type: 'text' }) // Use 'text' for longer messages
  message: string;

  @Column({ default: 'info' })
  type: string; // 'info', 'success', 'warning', 'error'

  @Column({ default: false })
  read: boolean;

  @Column({ nullable: true })
  actionUrl: string;

  @CreateDateColumn()
  createdAt: Date;
}
