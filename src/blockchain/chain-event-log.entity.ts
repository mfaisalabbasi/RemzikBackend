import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('chain_events_log')
export class ChainEventLog {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Unique hash constraint ensures no duplicate processing
   * if the sync loop restarts.
   */
  @Index({ unique: true })
  @Column()
  txHash: string;

  /**
   * Indexed for "RemzikScan" filtering (e.g., show all 'IdentityUpdated' events)
   */
  @Index()
  @Column()
  eventName: string;

  /**
   * Stores the full event payload as JSON for flexible audit/display.
   */
  @Column('jsonb')
  eventData: any;

  /**
   * Indexed for efficient sorting and pagination of the explorer.
   */
  @Index()
  @Column({ type: 'bigint' })
  blockNumber: number;

  @CreateDateColumn()
  createdAt: Date;
}
