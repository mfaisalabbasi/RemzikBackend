import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Asset } from '../asset/asset.entity';

@Entity('governance_proposals')
export class GovernanceProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  proposalId!: number; // Mapping to on-chain ID

  @Column()
  description!: string;

  @Column({
    type: 'varchar',
    default: 'PENDING',
  })
  status!: 'PENDING' | 'ACTIVE' | 'EXECUTED' | 'LIQUIDATED';

  @ManyToOne(() => Asset, (asset) => asset.governanceProposals)
  asset!: Asset;

  @CreateDateColumn()
  createdAt!: Date;
}
