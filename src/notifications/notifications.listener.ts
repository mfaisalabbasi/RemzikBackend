import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './enums/notification-type.enum';

@Injectable()
export class NotificationsListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('investment.created')
  async handleInvestmentCreated(payload: any) {
    await this.notificationsService.create({
      title: 'New Investment',
      message: `User ${payload.userId} invested ${payload.amount} SAR`,
      type: NotificationType.SUCCESS,
      userId: payload.userId,
    });
  }

  @OnEvent('payout.success')
  async handlePayoutSuccess(payload: any) {
    await this.notificationsService.create({
      title: 'Payout Successful',
      message: `Payout of ${payload.amount} SAR completed`,
      type: NotificationType.SUCCESS,
      userId: payload.userId,
    });
  }
}
