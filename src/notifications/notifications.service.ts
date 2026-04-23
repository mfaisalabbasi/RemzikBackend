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

  async getByUser(userId: string, role?: string): Promise<any[]> {
    // 1. Get private automated notifications (Investment confirmed, etc.)
    const privates = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    // 2. Build Query for Broadcasts and Targeted Admin Messages
    const targetRole = role?.toUpperCase();
    const broadcastConditions: any[] = [
      { target: BroadcastTarget.ALL },
      { target: BroadcastTarget.TARGETED, adminId: userId }, // Private admin-to-user messages
    ];

    if (targetRole?.includes('INVESTOR')) {
      broadcastConditions.push({ target: BroadcastTarget.INVESTORS });
    }
    if (targetRole?.includes('PARTNER')) {
      broadcastConditions.push({ target: BroadcastTarget.PARTNERS });
    }

    const broadcasts = await this.broadcastRepo.find({
      where: broadcastConditions,
      order: { createdAt: 'DESC' },
      take: 30,
    });

    // 3. Map Broadcasts to match frontend NotificationItem shape
    const mappedBroadcasts = broadcasts.map((b) => ({
      ...b,
      id: `bcast-${b.id}`,
      isBroadcast: true,
      read: false, // UI handles this via LocalStorage
    }));

    // 4. Merge both sources and sort by newest first
    return [...privates, ...mappedBroadcasts].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async markAsRead(id: string, userId: string) {
    if (id.startsWith('bcast-')) {
      return { success: true };
    }

    const result = await this.repo.update({ id, userId }, { read: true });
    if (result.affected === 0)
      throw new NotFoundException(`Notification ${id} not found`);
    return { success: true };
  }
}
