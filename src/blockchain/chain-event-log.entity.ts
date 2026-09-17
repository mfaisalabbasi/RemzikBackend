import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('chain_events_log')
@Index(['txHash', 'logIndex'], { unique: true }) // 🛡️ Composite unique constraint allows multi-event transactions while preventing duplicates
export class ChainEventLog {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Indexed for efficient transaction-based lookups
   */
  @Index()
  @Column()
  txHash: string;

  /**
   * Differentiates multiple events emitted within the same transaction hash
   */
  @Column({ type: 'int', default: 0 })
  logIndex: number;

  /**
   * Indexed for "RemzikScan" filtering (e.g., show all 'IdentityUpdated' events)
   */
  @Index()
  @Column()
  eventName: string;

  @Column({ default: 'SmartContract' })
  contractName: string;

  /**
   * Stores the full event payload as JSON for flexible audit/display.
   */
  @Column('jsonb')
  eventData: any;

  /**
   * Indexed for efficient sorting and pagination of the explorer.
   * Transformer handles number/string conversion seamlessly to prevent TypeScript errors and DB overflow.
   */
  @Index()
  @Column({
    type: 'varchar',
    nullable: true,
    transformer: {
      to: (value: number | string) => (value != null ? String(value) : null),
      from: (value: string | null) => (value != null ? Number(value) : null),
    },
  })
  blockNumber: number;

  @CreateDateColumn()
  createdAt: Date;
}
