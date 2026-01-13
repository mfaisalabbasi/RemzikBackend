import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PartnerService } from './partner.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { CreatePartnerProfileDto } from './dto/create-partner-profile.dto';
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('partners')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  /**
   * PARTNER creates their profile
   */
  @UseGuards(JwtAuthGuard)
  @Post('me')
  @Roles(UserRole.PARTNER)
  createMyProfile(@Req() req, @Body() dto: CreatePartnerProfileDto) {
    return this.partnerService.createProfile(req.user, dto);
  }

  /**
   * PARTNER views own profile
   */
  @Get('me')
  @Roles(UserRole.PARTNER)
  getMyProfile(@Req() req) {
    return this.partnerService.getMyProfile(req.user.userId);
  }

  /**
   * ADMIN updates / approves partner
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  updatePartner(@Param('id') id: string, @Body() dto: UpdatePartnerProfileDto) {
    return this.partnerService.updateProfile(id, dto);
  }
}
