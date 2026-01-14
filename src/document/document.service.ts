import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetDocument } from './document.entity';
import { Asset } from '../asset/asset.entity';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { DocumentStatus } from './enums/document-status.enum';

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(AssetDocument)
    private readonly docRepo: Repository<AssetDocument>,

    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  /**
   * Partner uploads document
   */
  async uploadDocument(
    filePath: string,
    dto: UploadDocumentDto,
  ): Promise<AssetDocument> {
    const asset = await this.assetRepo.findOne({
      where: { id: dto.assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const doc = this.docRepo.create({
      asset,
      type: dto.type,
      filePath,
    });

    return this.docRepo.save(doc);
  }

  /**
   * Admin reviews document
   */
  async reviewDocument(
    id: string,
    dto: ReviewDocumentDto,
  ): Promise<AssetDocument> {
    const doc = await this.docRepo.findOne({ where: { id } });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    if (doc.status === DocumentStatus.APPROVED) {
      throw new BadRequestException('Approved documents are immutable');
    }

    doc.status = dto.status;
    return this.docRepo.save(doc);
  }

  /**
   * Asset documents
   */
  async getAssetDocuments(assetId: string): Promise<AssetDocument[]> {
    return this.docRepo.find({
      where: { asset: { id: assetId } },
    });
  }
}
