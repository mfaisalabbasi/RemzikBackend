import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RevenueStatus } from '../enums/distribution-status.enum';
import { Asset } from 'src/asset/asset.entity';

@Entity('revenues')
export class Revenue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column('decimal')
  totalAmount: number;

  @Column('decimal')
  platformFee: number;

  @Column('decimal')
  distributableAmount: number;

  @Column({ type: 'enum', enum: RevenueStatus })
  status: RevenueStatus;

  @CreateDateColumn()
  createdAt: Date;
}
