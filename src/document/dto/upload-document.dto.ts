import { IsEnum, IsUUID } from 'class-validator';
import { DocumentType } from '../enums/document-type.enum';

export class UploadDocumentDto {
  @IsUUID()
  assetId: string;

  @IsEnum(DocumentType)
  type: DocumentType;
}
