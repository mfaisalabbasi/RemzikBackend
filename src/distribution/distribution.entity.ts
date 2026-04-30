import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { InvestorProfile } from 'src/investor/investor.entity';

@Entity('distributions')
export class Distribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Asset, { nullable: false })
  asset!: Asset;

  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor!: InvestorProfile;

  @Column('decimal', { precision: 15, scale: 2 })
  amount!: number;

  @Column()
  period!: string;

  @Column({ default: false })
  paid!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
