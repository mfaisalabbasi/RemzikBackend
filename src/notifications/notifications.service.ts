import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { Broadcast } from '../broadcast/broadcast.entity';
import { BroadcastTarget } from '../broadcast/enums/broadcast-target.enum';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    @InjectRepository(Broadcast)
    private readonly broadcastRepo: Repository<Broadcast>,
  ) {}

  async create(data: Partial<Notification>): Promise<Notification> {
    const notification = this.repo.create({ ...data, read: false });
    return await this.repo.save(notification);
  }

  // src/notifications/notifications.service.ts
  async getByUser(userId: string, role?: string): Promise<any[]> {
    // 1. Get private notifications
    const privates = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    // 2. Get Broadcasts for this role (INVESTORS/PARTNERS/ALL)
    const targetRole = role?.toUpperCase();
    const broadcasts = await this.broadcastRepo.find({
      where: [
        { target: BroadcastTarget.ALL },
        ...(targetRole ? [{ target: targetRole as any }] : []),
      ],
      order: { createdAt: 'DESC' },
      take: 30,
    });

    // 3. MAP BROADCASTS TO MATCH NOTIFICATION SHAPE
    // This ensures the "id" is stable on refresh
    const mappedBroadcasts = broadcasts.map((b) => ({
      ...b,
      id: `bcast-${b.id}`, // STABLE ID
      isBroadcast: true,
      read: false,
    }));

    // 4. Merge and return
    return [...privates, ...mappedBroadcasts].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async markAsRead(id: string, userId: string) {
    if (id.startsWith('bcast-')) {
      // Broadcast read status is handled on frontend LocalStorage
      return { success: true };
    }

    const result = await this.repo.update({ id, userId }, { read: true });
    if (result.affected === 0)
      throw new NotFoundException(
        `Notification ${id} not found or access denied`,
      );
    return { success: true };
  }
}
