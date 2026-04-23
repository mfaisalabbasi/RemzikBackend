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
   * Relation to the Main User
   */
  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /**
   * Explicit userId column for direct querying
   */
  @Column()
  userId: string;

  @Column()
  fullName: string;

  @Column()
  dob: string;

  /**
   * nullable: true fixes the 'contains null values' sync error.
   * This allows the database to update without crashing.
   */
  @Column({ type: 'text', nullable: true })
  idDocumentUrl: string;

  @Column({ type: 'text', nullable: true })
  addressProofUrl: string;

  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.PENDING,
  })
  status: KycStatus;

  @Column({ nullable: true, type: 'text' })
  rejectionReason?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
