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
import { User } from '../user/user.entity';
import { KycStatus } from './enums/kyc-status.enum';

@Injectable()
export class KycService {
  constructor(
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // USER submits KYC
  async submitKyc(userId: string, dto: SubmitKycDto): Promise<KycProfile> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let kyc = await this.kycRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (kyc && kyc.status === KycStatus.APPROVED) {
      throw new BadRequestException('Approved KYC cannot be modified');
    }

    if (!kyc) {
      kyc = this.kycRepo.create({
        user,
        documentNumber: dto.documentNumber,
        country: dto.country,
        status: KycStatus.PENDING,
      });
    } else {
      kyc.documentNumber = dto.documentNumber;
      kyc.country = dto.country;
      kyc.status = KycStatus.PENDING;
    }

    return this.kycRepo.save(kyc);
  }

  // ADMIN reviews KYC
  async reviewKyc(id: string, dto: ReviewKycDto): Promise<KycProfile> {
    const kyc = await this.kycRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!kyc) throw new NotFoundException('KYC not found');

    kyc.status = dto.status;
    return this.kycRepo.save(kyc);
  }
}
