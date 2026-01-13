import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerProfile } from './partner.entity';
import { CreatePartnerProfileDto } from './dto/create-partner-profile.dto';
import { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto';
import { User } from '../user/user.entity';
import { PartnerStatus } from './enums/partner-status.enum';

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,
  ) {}

  /**
   * Create partner profile for logged-in PARTNER user
   */
  async createProfile(
    user: User,
    dto: CreatePartnerProfileDto,
  ): Promise<PartnerProfile> {
    const existing = await this.partnerRepo.findOne({
      where: { user: { id: user.id } },
      relations: ['user'],
    });
    if (existing) {
      throw new BadRequestException('Partner profile already exists');
    }

    const profile = this.partnerRepo.create({
      user,
      companyName: dto.companyName,
      status: PartnerStatus.PENDING,
    });

    return this.partnerRepo.save(profile);
  }

  /**
   * Get partner profile for logged-in user
   */
  async getMyProfile(userId: string): Promise<PartnerProfile> {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Partner profile not found');
    }

    return profile;
  }

  /**
   * Admin-only update (approve / reject / edit)
   */
  async updateProfile(
    profileId: string,
    dto: UpdatePartnerProfileDto,
  ): Promise<PartnerProfile> {
    const profile = await this.partnerRepo.findOne({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException('Partner profile not found');
    }

    Object.assign(profile, dto);
    return this.partnerRepo.save(profile);
  }
}
