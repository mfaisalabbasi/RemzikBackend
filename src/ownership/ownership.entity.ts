import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';

@Entity('ownerships')
@Unique(['investor', 'asset'])
export class Ownership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Who owns
   */
  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor: InvestorProfile;

  /**
   * What asset
   */
  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  /**
   * Number of shares owned
   */
  @Column('decimal', { precision: 15, scale: 4 })
  shares: number;

  @Column({ type: 'int', default: 0 }) // ✅ add this if missing
  units: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
