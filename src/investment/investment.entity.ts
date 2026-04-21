import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { InvestorProfile } from '../investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { InvestmentStatus } from './enums/investment-status.enum';

@Entity('investments')
export class Investment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Who invested
   */
  @ManyToOne(() => InvestorProfile, { nullable: false })
  investor: InvestorProfile;

  /**
   * What asset
   */
  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  /**
   * Amount invested
   */
  // src/investment/investment.entity.ts

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    transformer: {
      // When saving to DB, keep it as is
      to: (value: number) => value,
      // When reading from DB, turn the string into a number
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  /**
   * Payment lifecycle
   */
  @Column({
    type: 'enum',
    enum: InvestmentStatus,
    default: InvestmentStatus.PENDING,
  })
  status: InvestmentStatus;

  @CreateDateColumn()
  createdAt: Date;
}
