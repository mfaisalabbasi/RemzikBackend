import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { PartnerStatus } from './enums/partner-status.enum';

@Entity('partner_profiles')
export class PartnerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * One user can have only ONE partner profile
   * This enforces clean business identity
   */
  @OneToOne(() => User)
  @JoinColumn()
  user: User;

  @Column()
  companyName: string;

  @Column({
    type: 'enum',
    enum: PartnerStatus,
    default: PartnerStatus.PENDING,
  })
  status: PartnerStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
