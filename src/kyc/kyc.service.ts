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

import { StorageService } from '../storage/storage.service';

@Injectable()
export class KycService {
  constructor(
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly storageService: StorageService,
  ) {}

  async submitKyc(
    userId: string,
    dto: SubmitKycDto,
    idDocument: Express.Multer.File,
    addressProof: Express.Multer.File,
  ): Promise<KycProfile> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const idUrl = await this.storageService.uploadFile(
      idDocument,
      'kyc/id-documents',
    );

    const addressUrl = await this.storageService.uploadFile(
      addressProof,
      'kyc/address-proofs',
    );

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
        fullName: dto.fullName,
        dob: dto.dob,
        idDocumentUrl: idUrl,
        addressProofUrl: addressUrl,
        status: KycStatus.PENDING,
      });
    } else {
      kyc.fullName = dto.fullName;
      kyc.dob = dto.dob;
      kyc.idDocumentUrl = idUrl;
      kyc.addressProofUrl = addressUrl;
      kyc.status = KycStatus.PENDING;
    }

    return this.kycRepo.save(kyc);
  }

  async reviewKyc(id: string, dto: ReviewKycDto): Promise<KycProfile> {
    const kyc = await this.kycRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!kyc) {
      throw new NotFoundException('KYC not found');
    }

    kyc.status = dto.status;

    return this.kycRepo.save(kyc);
  }

  async approve(kycId: string) {
    const kyc = await this.kycRepo.findOneBy({ id: kycId });

    if (!kyc) {
      throw new NotFoundException('KYC record not found');
    }

    kyc.status = KycStatus.APPROVED;

    await this.kycRepo.save(kyc);
  }

  async reject(kycId: string, reason: string) {
    const kyc = await this.kycRepo.findOneBy({ id: kycId });

    if (!kyc) {
      throw new NotFoundException('KYC record not found');
    }

    kyc.status = KycStatus.REJECTED;
    kyc.rejectionReason = reason;

    await this.kycRepo.save(kyc);
  }

  async findAllPending() {
    return this.kycRepo.find({
      where: {
        // 2. Use the Enum reference instead of the "PENDING" string
        status: KycStatus.PENDING,
      }, // Or whatever your pending string/enum is
      relations: ['user'], // Important for the "KYC Review: [Name]" logic
    });
  }
}
