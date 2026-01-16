import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/user/enums/user-role.enum';
import { AdminService } from './admin.service';
import { AdminActionDto } from './dto/admin-action.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('kyc/:id')
  moderateKyc(@Param('id') id: string, @Body() dto: AdminActionDto) {
    return this.adminService.moderateKyc(id, dto);
  }

  @Post('partner/:id')
  moderatePartner(@Param('id') id: string, @Body() dto: AdminActionDto) {
    return this.adminService.moderatePartner(id, dto);
  }

  @Post('asset/:id')
  moderateAsset(@Param('id') id: string, @Body() dto: AdminActionDto) {
    return this.adminService.moderateAsset(id, dto);
  }
}
