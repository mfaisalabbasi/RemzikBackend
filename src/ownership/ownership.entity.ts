import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';

@Entity('ownerships')
@Unique(['investorId', 'assetId']) // use foreign keys for uniqueness
export class Ownership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Who owns
   */
  @ManyToOne(() => InvestorProfile, { nullable: false })
  @JoinColumn({ name: 'investorId' }) // maps relation to investorId column
  investor: InvestorProfile;

  @Column()
  investorId: string; // foreign key column

  /**
   * What asset
   */
  @ManyToOne(() => Asset, { nullable: false })
  @JoinColumn({ name: 'assetId' }) // maps relation to assetId column
  asset: Asset;

  @Column()
  assetId: string; // foreign key column

  /**
   * Number of shares owned
   */
  @Column('decimal', { precision: 15, scale: 4, default: 0 })
  shares: number;

  /**
   * Number of units available for trading/sale
   */
  @Column('decimal', { precision: 15, scale: 4, default: 0 })
  units: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
