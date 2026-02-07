import {
  Entity,
  PrimaryGeneratedColumn,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../user/user.entity';

@Entity('investor_profiles')
export class InvestorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * One investor profile per user
   */
  @OneToOne(() => User, { eager: true })
  @JoinColumn()
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
