import { Injectable } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationType } from './enums/notification-type.enum';

@Injectable()
export class NotificationOrchestrator {
  constructor(
    private readonly service: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async buildAndSave(userId: string, eventName: string, data: any) {
    let config = {
      title: 'Update',
      message: 'You have a new notification.',
      actionUrl: '/dashboard',
      type: NotificationType.INFO,
    };

    if (eventName === 'investment.created') {
      config = {
        title: 'Investment Confirmed!',
        message: `SAR ${Number(data.amount)?.toLocaleString()} invested in "${data.asset}".`,
        actionUrl: '/investor/portfolio',
        type: NotificationType.SUCCESS,
      };
    }

    const notification = await this.service.create({ userId, ...config });
    this.gateway.sendNotification(userId, notification);
    return notification;
  }
}
