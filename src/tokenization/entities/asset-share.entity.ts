import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ShareStatus } from '../enums/share-status.enum';
import { Asset } from 'src/asset/asset.entity';

@Entity('asset_shares')
export class AssetShare {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column('int')
  totalShares: number;

  @Column('decimal', { precision: 12, scale: 2 })
  pricePerShare: number;

  @Column({ type: 'enum', enum: ShareStatus })
  status: ShareStatus;

  @CreateDateColumn()
  createdAt: Date;
}
