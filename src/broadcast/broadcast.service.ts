import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Broadcast } from './broadcast.entity';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { BroadcastGateway } from './broadcast.gateway';

@Injectable()
export class BroadcastService {
  constructor(
    @InjectRepository(Broadcast)
    private readonly broadcastRepo: Repository<Broadcast>,
    private readonly gateway: BroadcastGateway,
  ) {}

  async create(dto: CreateBroadcastDto, adminId: string): Promise<Broadcast> {
    try {
      const broadcast = this.broadcastRepo.create({
        ...dto,
        adminId,
      });

      const saved = await this.broadcastRepo.save(broadcast);

      // FIXED: Prefix the ID with 'bcast-' here to match the historical fetch
      // This ensures the first message is identical to the one seen on refresh
      this.gateway.emitNewBroadcast({
        id: `bcast-${saved.id}`,
        title: saved.title,
        message: saved.message,
        target: saved.target,
        createdAt: saved.createdAt,
        isBroadcast: true,
      });

      return saved;
    } catch (error) {
      throw new InternalServerErrorException('Could not process broadcast');
    }
  }

  async getRecent(limit: number = 20): Promise<Broadcast[]> {
    return this.broadcastRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
