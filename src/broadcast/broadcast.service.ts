import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Broadcast } from './broadcast.entity';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { BroadcastGateway } from './broadcast.gateway';
import { BroadcastTarget } from './enums/broadcast-target.enum';

@Injectable()
export class BroadcastService {
  constructor(
    @InjectRepository(Broadcast)
    private readonly broadcastRepo: Repository<Broadcast>,
    private readonly gateway: BroadcastGateway,
  ) {}

  async create(dto: CreateBroadcastDto, adminId: string): Promise<Broadcast> {
    try {
      const broadcast = this.broadcastRepo.create({ ...dto, adminId });
      const saved = (await this.broadcastRepo.save(
        broadcast,
      )) as any as Broadcast;

      this.gateway.emitNewBroadcast({
        id: `bcast-${saved.id}`,
        title: saved.title,
        message: saved.message,
        target: saved.target,
        createdAt: saved.createdAt,
        isBroadcast: true,
      });

      return saved;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      throw new InternalServerErrorException(
        `Could not process broadcast: ${msg}`,
      );
    }
  }

  async sendTargeted(
    userId: string,
    title: string,
    message: string,
    type: string,
  ) {
    try {
      const broadcast = this.broadcastRepo.create({
        title,
        message,
        target: BroadcastTarget.TARGETED,
        adminId: userId, // Recipient ID
      });

      const saved = (await this.broadcastRepo.save(
        broadcast,
      )) as any as Broadcast;

      if (this.gateway.server) {
        this.gateway.server.to(`user-${userId}`).emit('new_notification', {
          id: `direct-${saved.id}`,
          title: saved.title,
          message: saved.message,
          type: type,
          isBroadcast: false,
          createdAt: saved.createdAt,
        });
      }

      return { success: true, id: saved.id };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Targeted Dispatch Error:', msg);
      throw new InternalServerErrorException(
        `Could not dispatch targeted message: ${msg}`,
      );
    }
  }

  /**
   * FINALIZED FETCH LOGIC
   * Separates Investor, Partner, and Targeted broadcasts strictly.
   */
  async getRecent(
    limit: number = 20,
    userId?: string,
    role?: string,
  ): Promise<Broadcast[]> {
    if (userId) {
      // 1. Start with the two targets everyone sees: ALL and their OWN private messages
      const conditions: any[] = [
        { target: BroadcastTarget.ALL },
        { target: BroadcastTarget.TARGETED, adminId: userId },
      ];

      // 2. ONLY add Investor broadcasts if the user IS an investor
      if (role?.toLowerCase().includes('investor')) {
        conditions.push({ target: BroadcastTarget.INVESTORS });
      }

      // 3. ONLY add Partner broadcasts if the user IS a partner
      if (role?.toLowerCase().includes('partner')) {
        conditions.push({ target: BroadcastTarget.PARTNERS });
      }

      return this.broadcastRepo.find({
        where: conditions,
        order: { createdAt: 'DESC' } as any,
        take: limit,
      });
    }

    // Admin Dashboard view: Exclude private messages
    return this.broadcastRepo.find({
      where: {
        target: Not(BroadcastTarget.TARGETED),
      },
      order: { createdAt: 'DESC' } as any,
      take: limit,
    });
  }
}
