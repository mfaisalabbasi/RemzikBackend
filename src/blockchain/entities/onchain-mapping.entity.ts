import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Chain } from '../enums/chain.enum';
import { Asset } from 'src/asset/asset.entity';

@Entity('onchain_mappings')
export class OnchainMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column()
  contractAddress: string;

  @Column({ type: 'enum', enum: Chain })
  chain: Chain;

  @Column()
  totalMinted: number;

  @CreateDateColumn()
  createdAt: Date;
}
