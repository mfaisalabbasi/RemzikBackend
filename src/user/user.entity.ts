import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from './enums/user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;
  @Column()
  name: string; // MANDATORY (business rule)
  @Column()
  phone: string; // MANDATORY (business rule)

  @Column()
  password: string; // hashed

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.INVESTOR,
  })
  role: UserRole;

  @Column({ default: false })
  isVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
