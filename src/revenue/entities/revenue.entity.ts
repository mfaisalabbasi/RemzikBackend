import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';

@Entity('revenues')
export class Revenue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column('decimal', { precision: 12, scale: 2 })
  amount: number; // Total revenue collected

  @CreateDateColumn()
  receivedAt: Date;
}
