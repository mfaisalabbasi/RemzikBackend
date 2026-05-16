import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne, // Import this
} from 'typeorm';
import { UserRole } from './enums/user-role.enum';
import { KycProfile } from '../kyc/kyc.entity'; // Adjust path as needed

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  phone!: string;

  @Column()
  password!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
  })
  role!: UserRole;

  // ✅ ADD THIS RELATION
  // This allows TypeORM to find the KYC record via the User
  @OneToOne(() => KycProfile, (kyc) => kyc.user)
  kyc!: KycProfile;

  @Column({ default: false })
  isVerified!: boolean;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
