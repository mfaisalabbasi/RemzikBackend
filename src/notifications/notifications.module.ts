import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsListener } from './notifications.listener';
import { NotificationOrchestrator } from './notifications.orchestrator';
import { BroadcastModule } from 'src/broadcast/broadcast.module';
import { FirebaseProvider } from './firebase.provider'; // 👈 1. Import Firebase Provider
import { User } from 'src/user/user.entity'; // 👈 2. Import User Entity (adjust path if needed)

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, User]), // 👈 3. Added User repository here
    BroadcastModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    NotificationsListener,
    NotificationOrchestrator,
    FirebaseProvider, // 👈 4. Added Firebase Provider here
  ],
  exports: [
    NotificationsService,
    NotificationsGateway,
    NotificationOrchestrator,
    FirebaseProvider,
  ],
})
export class NotificationsModule {}
