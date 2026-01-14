import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Asset } from '../asset/asset.entity';
import { DocumentType } from './enums/document-type.enum';
import { DocumentStatus } from './enums/document-status.enum';

@Entity('asset_documents')
export class AssetDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { nullable: false })
  asset: Asset;

  @Column({
    type: 'enum',
    enum: DocumentType,
  })
  type: DocumentType;

  /**
   * Stored file path or S3 key
   */
  @Column()
  filePath: string;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    default: DocumentStatus.UPLOADED,
  })
  status: DocumentStatus;

  @CreateDateColumn()
  uploadedAt: Date;
}
