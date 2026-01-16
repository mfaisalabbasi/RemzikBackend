import { Asset } from 'src/asset/asset.entity';
import { User } from 'src/user/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('ownerships')
export class Ownership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { eager: true })
  investor: User;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column('int')
  sharesOwned: number;

  @CreateDateColumn()
  acquiredAt: Date;
}
