// src/user/user.controller.ts
import {
  Controller,
  Post,
  Patch,
  Body,
  Res,
  UseInterceptors,
  UploadedFiles,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response, Request } from 'express';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterWithKycDto } from './dto/register-with-kyc.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { SyncWalletDto } from './dto/sync-wallet.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { HttpCode, HttpStatus } from '@nestjs/common';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('signup')
  register(
    @Body() dto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.userService.register(dto, res);
  }

  @Post('register-with-kyc')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'idDocument', maxCount: 1 },
        { name: 'addressProof', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
      },
    ),
  )
  async registerWithKyc(
    @Body() dto: RegisterWithKycDto,
    @UploadedFiles()
    files: {
      idDocument?: Express.Multer.File[];
      addressProof?: Express.Multer.File[];
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.userService.registerWithKyc(dto, files, res);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-wallet')
  async syncWallet(
    @Body() dto: SyncWalletDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user?.userId;
    return this.userService.syncWalletAddress(
      userId,
      dto.walletAddress,
      dto.privyUserId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('fcm-token')
  async updateFcmToken(
    @Body() dto: UpdateFcmTokenDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user?.userId || req.user?.sub;
    return this.userService.updateFcmToken(userId, dto.fcmToken);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user?.userId || req.user?.sub;
    return this.userService.changePassword(userId, dto);
  }
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.userService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.userService.resetPassword(
      dto.email,
      dto.token,
      dto.newPassword,
    );
  }
}
