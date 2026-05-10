import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PartnerProfile } from './partner.entity';
import { CreatePartnerProfileDto } from './dto/create-partner-profile.dto';
import { UpdatePartnerCompanyDto } from './dto/update-partner-only.dto';
import { PartnerStatus } from './enums/partner-status.enum';
import { Asset } from '../asset/asset.entity';
import { StorageService } from '../storage/storage.service';
import { v4 as uuid } from 'uuid';

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,

    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,

    private readonly storageService: StorageService,
  ) {}

  // ✅ UPDATED: Added manager for transaction support
  async createProfile(
    userId: string,
    dto: CreatePartnerProfileDto,
    manager?: EntityManager,
  ): Promise<PartnerProfile> {
    const repo = manager
      ? manager.getRepository(PartnerProfile)
      : this.partnerRepo;

    const existing = await repo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (existing) {
      throw new BadRequestException('Partner profile already exists');
    }

    const profile = repo.create({
      companyName: dto.companyName,
      status: PartnerStatus.PENDING,
      user: { id: userId },
    });

    return repo.save(profile);
  }

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
    if (!partner) throw new NotFoundException('Partner not found');
    partner.status = PartnerStatus.APPROVED;
    await this.partnerRepo.save(partner);
  }

  async reject(partnerId: string, reason?: string) {
    const partner = await this.partnerRepo.findOneBy({ id: partnerId });
    if (!partner) throw new NotFoundException('Partner not found');
    partner.status = PartnerStatus.REJECTED;
    await this.partnerRepo.save(partner);
  }

  async getProfile(userId: string) {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return {
      id: profile.id,
      companyName: profile.companyName,
      status: profile.status,
      avatar: profile.avatar || null,
      address: profile.address || null,
      name: profile.user?.name,
      email: profile.user?.email,
      phone: profile.user?.phone,
    };
  }

  async updateProfile(userId: string, body: any) {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    if (body.address) profile.address = body.address;
    if (body.avatar) profile.avatar = body.avatar;
    if (body.name) profile.user.name = body.name;

    await this.partnerRepo.save(profile);

    if (body.name) {
      await this.partnerRepo.manager.save(profile.user);
    }

    return { message: 'Profile updated successfully' };
  }

  async getProfileStats(userId: string) {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const assets = await this.assetRepo.find({
      where: { partner: { id: profile.id } },
    });

    const totalAssets = assets.length;
    const totalFunding = assets.reduce(
      (sum, a: any) => sum + (Number(a.totalValue) || 0),
      0,
    );

    const totalInvestors =
      totalFunding > 0 ? Math.floor(totalFunding / 10000) : 0;

    return {
      totalAssets,
      totalFunding,
      totalInvestors,
    };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const ext = file.originalname.split('.').pop();
    const safeName = `${uuid()}-${Date.now()}.${ext}`;

    const cleanFile = {
      ...file,
      originalname: safeName,
    };

    const avatarUrl = await this.storageService.uploadFile(
      cleanFile as Express.Multer.File,
      'partner/avatars',
    );

    profile.avatar = avatarUrl;
    await this.partnerRepo.save(profile);

    return {
      url: avatarUrl,
    };
  }

  async countPartners(): Promise<number> {
    return await this.partnerRepo.count();
  }

  async findAllPending() {
    return this.partnerRepo.find({
      where: {
        status: PartnerStatus.PENDING,
      },
    });
  }

  async uploadBusinessDocs(userId: string, files: any) {
    const profile = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
    });

    if (!profile) throw new NotFoundException('Partner profile not found');

    // Prevent re-upload if already approved
    if (profile.status === PartnerStatus.APPROVED) {
      throw new BadRequestException('Profile already approved');
    }

    let crUrl = profile.commercialRegistration;
    let taxUrl = profile.amlPolicy;

    try {
      if (files?.crDocument?.[0]) {
        crUrl = await this.storageService.uploadFile(
          files.crDocument[0],
          'partners/cr',
        );
      }
      if (files?.taxDocument?.[0]) {
        taxUrl = await this.storageService.uploadFile(
          files.taxDocument[0],
          'partners/tax',
        );
      }
    } catch (error) {
      throw new BadRequestException('Failed to upload documents to S3');
    }

    profile.commercialRegistration = crUrl;
    profile.amlPolicy = taxUrl;
    profile.status = PartnerStatus.PENDING; // Reset to pending for admin review

    await this.partnerRepo.save(profile);

    return {
      message: 'Business documents uploaded successfully',
      status: profile.status,
    };
  }
}
