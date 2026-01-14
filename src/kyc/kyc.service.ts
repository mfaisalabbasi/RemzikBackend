import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycProfile } from './kyc.entity';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { KycStatus } from './enums/kyc-status.enum';
import { User } from '../user/user.entity';

@Injectable()
export class KycService {
  constructor(
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,
  ) {}

  /**
   * Submit or update KYC
   */
  async submitKyc(user: User, dto: SubmitKycDto): Promise<KycProfile> {
    let kyc = await this.kycRepo.findOne({
      where: { user: { id: user.id } },
      relations: ['user'],
    });

    if (!kyc) {
      kyc = this.kycRepo.create({
        user,
        documentNumber: dto.documentNumber,
        country: dto.country,
        status: KycStatus.PENDING,
      });
    } else {
      if (kyc.status === KycStatus.APPROVED) {
        throw new BadRequestException('Approved KYC cannot be modified');
      }

      kyc.documentNumber = dto.documentNumber;
      kyc.country = dto.country;
      kyc.status = KycStatus.PENDING;
    }

    return this.kycRepo.save(kyc);
  }

  /**
   * Admin review
   */
  async reviewKyc(id: string, dto: ReviewKycDto): Promise<KycProfile> {
    const kyc = await this.kycRepo.findOne({ where: { id } });

    if (!kyc) {
      throw new NotFoundException('KYC record not found');
    }

    kyc.status = dto.status;
    return this.kycRepo.save(kyc);
  }

  /**
   * Get my KYC
   */
  async getMyKyc(userId: string): Promise<KycProfile> {
    const kyc = await this.kycRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!kyc) {
      throw new NotFoundException('KYC not submitted');
    }

    return kyc;
  }
}
