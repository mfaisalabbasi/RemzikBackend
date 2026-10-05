import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { InvestmentStatus } from './enums/investment-status.enum';
import { SettlementMode } from './dto/create-investment.dto'; // Adjust import path if needed

@Entity('investments')
@Index(['txHash'], { unique: true, where: '"txHash" IS NOT NULL' })
export class Investment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor: InvestorProfile;

  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 4,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  units: number;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : null),
    },
  })
  unitPriceAtPurchase: number;

  /**
   * ✅ NEW: Settlement Mode (OFF_CHAIN or ON_CHAIN)
   */
  @Column({
    type: 'enum',
    enum: SettlementMode,
    default: SettlementMode.OFF_CHAIN,
  })
  settlementMode: SettlementMode;

  /**
   * ✅ NEW: Web3 Intent Security Snapshots (Immutable audit trail)
   */
  @Column({ nullable: true })
  expectedWalletAddress: string;

  @Column({ nullable: true })
  expectedVaultAddress: string;

  @Column({ nullable: true })
  expectedStablecoinAddress: string;

  @Column({ type: 'varchar', nullable: true })
  expectedStablecoinAmount: string;

  @Column({ type: 'varchar', nullable: true })
  expectedTokenAmount: string;

  @Column({ type: 'text', nullable: true })
  expectedCalldata: string;

  @Column({ type: 'bigint', nullable: true })
  expectedChainId: string;

  @Column({ type: 'timestamp', nullable: true })
  intentExpiresAt: Date;

  @Column({
    type: 'enum',
    enum: InvestmentStatus,
    default: InvestmentStatus.PENDING,
  })
  status: InvestmentStatus;

  @Column({ nullable: true })
  txHash: string;

  @Column({
    type: 'varchar',

    nullable: true,
  })
  walletAddress?: string;

  @Column({
    type: 'bigint',

    nullable: true,
  })
  blockNumber?: string;

  @Column({
    type: 'varchar',

    nullable: true,
  })
  blockHash?: string;

  @Column({
    type: 'text',

    nullable: true,
  })
  failureReason?: string;
  @Column({
    type: 'timestamp',

    nullable: true,
  })
  confirmedAt?: Date;

  @Column({
    type: 'timestamp',

    nullable: true,
  })
  failedAt?: Date;

  @Column({
    type: 'varchar',

    nullable: true,
  })
  expectedTokenAddress?: string;

  @CreateDateColumn()
  createdAt: Date;
}
