// src/recovery/recovery.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RecoveryService } from './recovery.service';
import { CreateRecoveryRequestDto } from './recovery.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('recovery')
export class RecoveryController {
  constructor(private readonly recoveryService: RecoveryService) {}

  @Post('request')
  @Roles(UserRole.INVESTOR)
  async createRequest(@Req() req, @Body() dto: CreateRecoveryRequestDto) {
    const userId = req.user.userId || req.user.id;
    return this.recoveryService.createRequest(userId, dto);
  }

  @Post('verification')
  @Roles(UserRole.INVESTOR)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'document', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
      },
    ),
  )
  async submitVerification(
    @Req() req,
    @Body()
    body: {
      requestId: string;
      documentType: string;
      phoneOtp?: string;
      emailOtp?: string;
    },
    @UploadedFiles()
    files: {
      document?: Express.Multer.File[];
      selfie?: Express.Multer.File[];
    },
  ) {
    const userId = req.user.userId || req.user.id;
    const documentFile = files?.document ? files.document[0] : null;
    const selfieFile = files?.selfie ? files.selfie[0] : null;

    return this.recoveryService.submitVerification(userId, {
      requestId: body.requestId,
      documentType: body.documentType,
      documentFile,
      selfieFile,
      phoneOtp: body.phoneOtp || '',
      emailOtp: body.emailOtp || '',
    });
  }

  @Get('status')
  @Roles(UserRole.INVESTOR)
  async getStatus(@Req() req) {
    const userId = req.user.userId || req.user.id;
    const requests = await this.recoveryService.getRequestsByUser(userId);
    const latestRequest = requests && requests.length > 0 ? requests[0] : null;
    return { request: latestRequest };
  }

  @Get('my-requests')
  @Roles(UserRole.INVESTOR)
  async getMyRequests(@Req() req) {
    const userId = req.user.userId || req.user.id;
    return this.recoveryService.getRequestsByUser(userId);
  }

  // Added endpoint for admin dashboard to list all global recovery requests
  @Get('admin/all')
  @Roles(UserRole.ADMIN)
  async getAllRecoveriesForAdmin() {
    return this.recoveryService.getAllRequestsForAdmin();
  }

  @Patch('admin/:id/approve')
  @Roles(UserRole.ADMIN)
  async approveRecovery(
    @Param('id') id: string,
    @Body() body: { tokenAddress: string; amount: string },
  ) {
    return this.recoveryService.approveAndExecute(
      id,
      body.tokenAddress || '0x_default_token',
      body.amount || '0',
    );
  }
}
