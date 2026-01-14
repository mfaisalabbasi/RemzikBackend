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
import { KycStatus } from './enums/kyc-status.enum';

@Entity('kyc_profiles')
export class KycProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * One KYC per user
   */
  @OneToOne(() => User, { nullable: false })
  @JoinColumn()
  user: User;

  /**
   * National ID / Iqama / Passport
   */
  @Column()
  documentNumber: string;

  /**
   * Country of issuance
   */
  @Column()
  country: string;

  /**
   * Compliance state
   */
  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.NOT_SUBMITTED,
  })
  status: KycStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
