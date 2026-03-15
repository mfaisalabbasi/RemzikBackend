import {
  Controller,
  Post,
  Patch,
  Body,
  Req,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';

import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/guards/jwt.gaurd';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';

const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];

function fileFilter(req: any, file: Express.Multer.File, callback: any) {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return callback(
      new BadRequestException(
        'Invalid file type. Only JPG, PNG and PDF files are allowed.',
      ),
      false,
    );
  }

  callback(null, true);
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('submit')
  @Roles(UserRole.INVESTOR, UserRole.PARTNER)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'idDocument', maxCount: 1 },
        { name: 'addressProof', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),

        limits: {
          fileSize: 5 * 1024 * 1024, // 5MB
        },

        fileFilter,
      },
    ),
  )
  submit(
    @Req() req,
    @Body() dto: SubmitKycDto,
    @UploadedFiles()
    files: {
      idDocument?: Express.Multer.File[];
      addressProof?: Express.Multer.File[];
    },
  ) {
    if (!files?.idDocument || !files?.addressProof) {
      throw new BadRequestException(
        'Both ID document and address proof are required',
      );
    }

    return this.kycService.submitKyc(
      req.user.userId,
      dto,
      files.idDocument[0],
      files.addressProof[0],
    );
  }

  @Patch(':id/review')
  @Roles(UserRole.ADMIN)
  review(@Param('id') id: string, @Body() dto: ReviewKycDto) {
    return this.kycService.reviewKyc(id, dto);
  }
}
