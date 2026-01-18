import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvestorProfile } from './investor.entity';
import { User } from '../user/user.entity';

@Injectable()
export class InvestorService {
  constructor(
    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,
  ) {}

  /**
   * Create investor profile
   */
  async createProfile(userId: string): Promise<InvestorProfile> {
    const existing = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (existing) {
      throw new BadRequestException('Investor profile already exists');
    }

    const profile = this.investorRepo.create({ user: { id: userId } as User });
    return this.investorRepo.save(profile);
  }

  /**
   * Get logged-in investor profile
   */
  async getMyProfile(userId: string): Promise<InvestorProfile> {
    const profile = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Investor profile not found');
    }

    return profile;
  }
}
