import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsListener } from './notifications.listener';
import { NotificationOrchestrator } from './notifications.orchestrator'; // <--- 1. Import it
import { BroadcastModule } from 'src/broadcast/broadcast.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification]), BroadcastModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    NotificationsListener,
    NotificationOrchestrator, // <--- 2. ADD IT HERE
  ],
  exports: [
    NotificationsService,
    NotificationsGateway,
    NotificationOrchestrator,
  ], // <--- 3. Export it (optional, but good practice)
})
export class NotificationsModule {}
