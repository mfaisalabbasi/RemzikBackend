import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  OneToMany, // Added
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { PartnerStatus } from './enums/partner-status.enum';
import { Asset } from '../asset/asset.entity'; // Import Asset

@Entity('partner_profiles')
export class PartnerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @OneToMany(() => Asset, (asset) => asset.partner)
  assets: Asset[];

  // --- NEW KYC DOCUMENT COLUMNS (All Nullable) ---

  @Column({ type: 'text', nullable: true })
  articlesOfAssociation?: string;

  @Column({ type: 'text', nullable: true })
  commercialRegistration?: string;

  @Column({ type: 'text', nullable: true })
  signatoryId?: string;

  @Column({ type: 'text', nullable: true })
  amlPolicy?: string;

  // --- END NEW COLUMNS ---

  @Column({ nullable: true })
  avatar?: string;

  @Column({ nullable: true })
  address?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
