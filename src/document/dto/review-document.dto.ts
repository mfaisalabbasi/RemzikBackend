import { IsEnum } from 'class-validator';
import { DocumentStatus } from '../enums/document-status.enum';

export class ReviewDocumentDto {
  @IsEnum(DocumentStatus)
  status: DocumentStatus;
}
