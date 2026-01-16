import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from 'src/user/user.entity';
import { TransferStatus } from '../enums/transfer-status.enum';
import { Listing } from './listing.entity';

@Entity('ownership_transfers')
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Listing, { eager: true })
  listing: Listing;

  @ManyToOne(() => User, { eager: true })
  buyer: User;

  @Column('decimal')
  percentageTransferred;

  @Column({ type: 'enum', enum: TransferStatus })
  status: TransferStatus;

  @CreateDateColumn()
  createdAt: Date;
}
