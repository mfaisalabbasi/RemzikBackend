import {
  Controller,
  Post,
  Body,
  Res,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterWithKycDto } from './dto/register-with-kyc.dto';

@Controller('auth')
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
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
}
