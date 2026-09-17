import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Asset } from 'src/asset/asset.entity';
import { InvestorProfile } from 'src/investor/investor.entity';
import { PayoutStatus } from './enums/payout-status.enum';

export enum DistributionMode {
  OFF_CHAIN = 'OFF_CHAIN',
  ON_CHAIN = 'ON_CHAIN',
}

// distribution.entity.ts
@Entity('distributions')
@Index(['batchId', 'investor'], { unique: true }) // 🛡️ Protects against duplicate payouts per batch
export class Distribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Asset, { nullable: false })
  asset!: Asset;

  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor!: InvestorProfile;

  @Column('decimal', { precision: 18, scale: 2 })
  amount!: number;

  @Column()
  period!: string; // e.g., "Q1-2026"

  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.PENDING })
  status!: PayoutStatus;

  // 🚀 New fields for Hybrid On-Chain / Off-Chain Routing
  @Column({
    type: 'enum',
    enum: DistributionMode,
    default: DistributionMode.OFF_CHAIN,
  })
  distributionMode!: DistributionMode;

  @Column({ type: 'jsonb', nullable: true })
  merkleProof!: string[]; // Stores individual Merkle proof array for on-chain claims

  @Column({ nullable: true })
  claimTxHash!: string; // Tracks the blockchain transaction hash when the user claims on-chain

  @Column({ type: 'timestamp', nullable: true })
  claimedAt!: Date; // Timestamp of the trustless claim event execution

  @Column({ nullable: true })
  batchId!: string; // Groups all payouts for one event (e.g., "RENT-JUNE-2026")

  @CreateDateColumn()
  createdAt!: Date;
}
