import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async create(data: Partial<Notification>): Promise<Notification> {
    // Force read to false on creation
    const notification = this.repo.create({ ...data, read: false });
    return await this.repo.save(notification);
  }

  async getByUser(userId: string): Promise<Notification[]> {
    console.log('DEBUG: Looking for notifications for userId:', userId);

    const notifications = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    console.log('DEBUG: Notifications found in DB:', notifications.length);
    return notifications;
  }

  async markAsRead(id: string, userId: string) {
    // Added userId check to ensure users can only mark THEIR OWN notifications
    const result = await this.repo.update({ id, userId }, { read: true });
    if (result.affected === 0)
      throw new NotFoundException(
        `Notification ${id} not found or access denied`,
      );
    return { success: true };
  }
}
