import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Asset } from '../../asset/asset.entity';

@Entity('asset_tokens')
export class AssetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Which asset is tokenized
   */
  @OneToOne(() => Asset)
  @JoinColumn()
  asset: Asset;

  /**
   * Total number of shares
   */
  @Column()
  totalShares: number;

  /**
   * Price of one share
   */
  @Column('decimal', { precision: 15, scale: 2 })
  sharePrice: number;

  /**
   * Shares still available
   */
  @Column()
  availableShares: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
