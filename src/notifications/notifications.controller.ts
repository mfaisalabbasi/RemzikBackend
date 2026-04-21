import {
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async getMyNotifications(
    @Req() req: any,
    @Query('role') role?: string, // 👈 FIXED: Added Query parameter to capture the role
  ) {
    // Passes the role from the URL to the service
    return this.service.getByUser(req.user.userId, role);
  }

  @Patch(':id/read')
  async markAsRead(@Req() req: any, @Param('id') id: string) {
    return this.service.markAsRead(id, req.user.userId);
  }
}
