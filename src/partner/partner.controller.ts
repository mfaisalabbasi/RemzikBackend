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
  UploadedFile,
} from '@nestjs/common';
import { PartnerService } from './partner.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { CreatePartnerProfileDto } from './dto/create-partner-profile.dto';
import { UpdatePartnerCompanyDto } from './dto/update-partner-only.dto';
import { UpdatePartnerStatusDto } from './dto/update-admin-only.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { UploadedFiles } from '@nestjs/common';
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  @Post('me')
  @Roles(UserRole.PARTNER)
  createMyProfile(@Req() req, @Body() dto: CreatePartnerProfileDto) {
    return this.partnerService.createProfile(req.user.userId, dto);
  }

  @Get('me')
  @Roles(UserRole.PARTNER)
  getMyProfile(@Req() req) {
    return this.partnerService.getMyProfile(req.user.userId);
  }

  @Patch('me')
  @Roles(UserRole.PARTNER)
  updateMyProfile(@Req() req, @Body() dto: UpdatePartnerCompanyDto) {
    return this.partnerService.updateCompany(req.user.userId, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePartnerStatusDto) {
    return this.partnerService.updateStatus(id, dto.status);
  }

  // ✅ PROFILE
  @Get('profile')
  @Roles(UserRole.PARTNER)
  getProfile(@Req() req) {
    return this.partnerService.getProfile(req.user.userId);
  }

  @Patch('profile')
  @Roles(UserRole.PARTNER)
  updateProfile(@Req() req, @Body() body) {
    return this.partnerService.updateProfile(req.user.userId, body);
  }

  @Get('profile/stats')
  @Roles(UserRole.PARTNER)
  getStats(@Req() req) {
    return this.partnerService.getProfileStats(req.user.userId);
  }

  // ✅ AVATAR UPLOAD
  @Post('profile/avatar')
  @Roles(UserRole.PARTNER)
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(@Req() req, @UploadedFile() file: Express.Multer.File) {
    return this.partnerService.uploadAvatar(req.user.userId, file);
  }

  @Post('verify-business')
  @Roles(UserRole.PARTNER)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'crDocument', maxCount: 1 },
      { name: 'taxDocument', maxCount: 1 },
    ]),
  )
  async verifyBusiness(
    @Req() req,
    @UploadedFiles()
    files: {
      crDocument?: Express.Multer.File[];
      taxDocument?: Express.Multer.File[];
    },
  ) {
    return this.partnerService.uploadBusinessDocs(req.user.userId, files);
  }

  // ✅ NEW: Get verification status for the frontend component
  @Get('business-profile')
  @Roles(UserRole.PARTNER)
  async getBusinessProfile(@Req() req) {
    const profile = await this.partnerService.getMyProfile(req.user.userId);
    return {
      status: profile.status,
      companyName: profile.companyName,
      hasCr: !!profile.commercialRegistration,
      hasTax: !!profile.amlPolicy, // mapping tax/aml policy as per your entity
    };
  }
}
