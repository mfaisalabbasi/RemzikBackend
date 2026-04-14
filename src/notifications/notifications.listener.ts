import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationOrchestrator } from './notifications.orchestrator';

@Injectable()
export class NotificationsListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly orchestrator: NotificationOrchestrator,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.eventEmitter.on('investment.created', async (payload: any) => {
      const { userId, ...data } = payload;
      if (!userId) return;

      try {
        await this.orchestrator.buildAndSave(
          userId,
          'investment.created',
          data,
        );
      } catch (error) {
        this.logger.error(`Listener failed: ${error}`);
      }
    });
  }
}
