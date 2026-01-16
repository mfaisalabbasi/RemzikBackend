import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ListingStatus } from '../enums/listing-status.enum';
import { User } from 'src/user/user.entity';
import { Asset } from 'src/asset/asset.entity';

@Entity('market_listings')
export class Listing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @ManyToMany(() => User, { eager: true })
  seller: User;

  @Column('decimal')
  percentageForSale;

  @Column('decimal')
  price;

  @Column({ type: 'enum', enum: ListingStatus })
  status: ListingStatus;

  @CreateDateColumn()
  createdAt: Date;
}
