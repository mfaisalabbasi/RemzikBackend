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
  @OneToOne(() => Asset, (asset) => asset.token)
  @JoinColumn()
  asset: Asset;

  /**
   * ✅ PRECISION UPDATE: Total number of shares
   */
  @Column({ type: 'decimal', precision: 20, scale: 4, default: 0 })
  totalShares: number;

  /**
   * Price of one share (Currency: Scale 2)
   */
  @Column('decimal', {
    precision: 15,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  sharePrice: number;

  /**
   * ✅ PRECISION UPDATE: Shares still available
   */
  @Column({ type: 'decimal', precision: 20, scale: 4, default: 0 })
  availableShares: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
