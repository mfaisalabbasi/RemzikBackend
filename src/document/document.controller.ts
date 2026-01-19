import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * PARTNER uploads asset document
   */
  @Post('upload')
  @Roles(UserRole.PARTNER)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documentService.uploadDocument(file.path, dto);
  }

  /**
   * ADMIN reviews document
   */
  @Patch(':id/review')
  @Roles(UserRole.ADMIN)
  review(@Param('id') id: string, @Body() dto: ReviewDocumentDto) {
    return this.documentService.reviewDocument(id, dto);
  }

  /**
   * View documents for asset
   */
  @Get('asset/:assetId')
  getAssetDocs(@Param('assetId') assetId: string) {
    return this.documentService.getAssetDocuments(assetId);
  }
}
