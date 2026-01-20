// src/admin/admin.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminActionDto } from './dto/admin-action.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('partner-action')
  @Roles(UserRole.ADMIN)
  handlePartner(@Body() dto: AdminActionDto, @Req() req) {
    return this.adminService.handlePartnerAction(dto, req.user.userId);
  }

  @Post('asset-action')
  @Roles(UserRole.ADMIN)
  handleAsset(@Body() dto: AdminActionDto, @Req() req) {
    return this.adminService.handleAssetAction(dto, req.user.userId);
  }

  @Post('kyc-action')
  @Roles(UserRole.ADMIN)
  handleKyc(@Body() dto: AdminActionDto, @Req() req) {
    return this.adminService.handleKycAction(dto, req.user.userId);
  }
}
