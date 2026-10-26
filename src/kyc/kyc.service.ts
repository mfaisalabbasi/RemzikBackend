import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { KycProfile } from './kyc.entity';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';

import { User } from '../user/user.entity';
import { KycStatus } from './enums/kyc-status.enum';

import { StorageService } from '../storage/storage.service';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly storageService: StorageService,
    private readonly notificationOrchestrator: NotificationOrchestrator,
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

    const savedKyc = await this.kycRepo.save(kyc);

    // 🛡️ NOTIFICATION: Inform user that KYC was submitted
    try {
      await this.notificationOrchestrator.buildAndSave(
        userId,
        'kyc.submitted',
        {
          title: 'KYC Documents Submitted',
          message:
            'Your identity verification documents have been received and are pending review.',
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send KYC submission notification: ${err}`);
    }

    return savedKyc;
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
    const updatedKyc = await this.kycRepo.save(kyc);

    if (dto.status === KycStatus.APPROVED && kyc.user) {
      await this.approve(kyc.id);
    } else if (dto.status === KycStatus.REJECTED && kyc.user) {
      await this.reject(kyc.id, 'Review failed');
    }

    return updatedKyc;
  }

  async approve(kycId: string) {
    const kyc = await this.kycRepo.findOne({
      where: { id: kycId },
      relations: ['user'],
    });

    if (!kyc) {
      throw new NotFoundException('KYC record not found');
    }

    kyc.status = KycStatus.APPROVED;
    await this.kycRepo.save(kyc);

    // 🛡️ NOTIFICATION: Inform user of KYC approval
    if (kyc.user) {
      try {
        await this.notificationOrchestrator.buildAndSave(
          kyc.user.id,
          'kyc.approved',
          {
            title: 'KYC Verified!',
            message:
              'Your identity verification has been approved. You now have full platform access.',
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to send KYC approval notification: ${err}`);
      }
    }
  }

  async reject(kycId: string, reason: string) {
    const kyc = await this.kycRepo.findOne({
      where: { id: kycId },
      relations: ['user'],
    });

    if (!kyc) {
      throw new NotFoundException('KYC record not found');
    }

    kyc.status = KycStatus.REJECTED;
    kyc.rejectionReason = reason;

    await this.kycRepo.save(kyc);

    // 🛡️ NOTIFICATION: Inform user of KYC rejection
    if (kyc.user) {
      try {
        await this.notificationOrchestrator.buildAndSave(
          kyc.user.id,
          'kyc.rejected',
          {
            title: 'KYC Verification Rejected',
            message: `Your identity verification was rejected. Reason: ${reason}`,
            reason,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to send KYC rejection notification: ${err}`);
      }
    }
  }

  async findAllPending() {
    return this.kycRepo.find({
      where: {
        status: KycStatus.PENDING,
      },
      relations: ['user'],
    });
  }
}
