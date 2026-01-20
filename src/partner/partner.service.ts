import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerProfile } from './partner.entity';
import { CreatePartnerProfileDto } from './dto/create-partner-profile.dto';
import { UpdatePartnerCompanyDto } from './dto/update-partner-only.dto';
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
    userId: string,
    dto: CreatePartnerProfileDto,
  ): Promise<PartnerProfile> {
    const existing = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });
    if (existing) {
      throw new BadRequestException('Partner profile already exists');
    }

    const profile = this.partnerRepo.create({
      companyName: dto.companyName,
      status: PartnerStatus.PENDING,
      user: { id: userId },
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

  async updateCompany(
    userId: string,
    dto: UpdatePartnerCompanyDto,
  ): Promise<PartnerProfile> {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Partner profile not found');
    }

    // Optional business rule
    if (profile.status !== PartnerStatus.PENDING) {
      throw new BadRequestException('Cannot update company after approval');
    }

    profile.companyName = dto.companyName;

    return this.partnerRepo.save(profile);
  }

  async updateStatus(id: string, status: PartnerStatus) {
    const partner = await this.partnerRepo.findOneBy({ id });

    if (!partner) throw new NotFoundException();

    if (partner.status !== PartnerStatus.PENDING) {
      throw new BadRequestException('Status already decided');
    }

    partner.status = status;
    return this.partnerRepo.save(partner);
  }

  async approve(partnerId: string) {
    const partner = await this.partnerRepo.findOneBy({ id: partnerId });

    if (!partner) {
      throw new NotFoundException('Partner not found');
    }

    partner.status = PartnerStatus.APPROVED;
    await this.partnerRepo.save(partner);
  }

  async reject(partnerId: string, reason?: string) {
    const partner = await this.partnerRepo.findOneBy({ id: partnerId });

    if (!partner) {
      throw new NotFoundException('Partner not found');
    }

    partner.status = PartnerStatus.REJECTED;
    // partner.rejectionReason = reason;

    await this.partnerRepo.save(partner);
  }
}
