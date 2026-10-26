import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecoveryRequestEntity, RecoveryStatus } from './recovery.entity';
import { CreateRecoveryRequestDto } from './recovery.dto';
import { User } from '../user/user.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { StorageService } from '../storage/storage.service';
import { ethers } from 'ethers';
import { Ownership } from '../ownership/ownership.entity';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @InjectRepository(RecoveryRequestEntity)
    private readonly recoveryRepo: Repository<RecoveryRequestEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly blockchainService: BlockchainService,
    private readonly storageService: StorageService,
    private readonly notificationOrchestrator: NotificationOrchestrator,
  ) {}

  async createRequest(
    userId: string,
    dto: CreateRecoveryRequestDto,
  ): Promise<RecoveryRequestEntity> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    const currentWallet = user?.walletAddress || dto.oldWallet || '';
    if (!currentWallet) {
      throw new BadRequestException('No active wallet found to recover from.');
    }

    const targetWallet =
      dto.newWallet && dto.newWallet !== 'dummy' ? dto.newWallet : '';

    const recovery = this.recoveryRepo.create({
      userId,
      oldWallet: currentWallet,
      newWallet: targetWallet,
      reason: dto.reason || 'Loss of device/privy access',
      documentUrls: [],
      status: RecoveryStatus.PENDING_DOCUMENTS,
    });
    const savedRecovery = await this.recoveryRepo.save(recovery);

    // 🛡️ NOTIFICATION: Inform user recovery initiated
    try {
      await this.notificationOrchestrator.buildAndSave(
        userId,
        'recovery.created',
        {
          title: 'Wallet Recovery Initiated',
          message:
            'Your wallet recovery request has been logged. Please submit your verification documents.',
          requestId: savedRecovery.id,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to send recovery creation notification: ${err}`,
      );
    }

    return savedRecovery;
  }

  async approveAndExecute(
    requestId: string,
    tokenAddress: string,
    amount: string,
  ): Promise<RecoveryRequestEntity> {
    const request = await this.recoveryRepo.findOne({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Recovery request not found');
    if (
      request.status !== RecoveryStatus.PENDING_DOCUMENTS &&
      request.status !== RecoveryStatus.UNDER_REVIEW &&
      request.status !== RecoveryStatus.APPROVED
    ) {
      throw new BadRequestException('Request is already processed or rejected');
    }

    const user = await this.userRepo.findOne({ where: { id: request.userId } });
    if (!user || !user.privyUserId) {
      throw new BadRequestException(
        'User record or associated Privy ID not found for wallet provisioning.',
      );
    }

    const newWallet =
      request.newWallet && request.newWallet !== 'dummy'
        ? request.newWallet
        : await this.blockchainService.generateEmbeddedWalletForUser(
            user.privyUserId,
          );

    request.newWallet = newWallet;
    request.status = RecoveryStatus.APPROVED;
    await this.recoveryRepo.save(request);

    try {
      request.status = RecoveryStatus.PROCESSING_BLOCKCHAIN;
      await this.recoveryRepo.save(request);

      await this.blockchainService.ensureWalletWhitelisted(newWallet);

      let txHash = '';

      if (
        tokenAddress &&
        tokenAddress !== ethers.ZeroAddress &&
        tokenAddress !== '0x_default_token'
      ) {
        const resolvedAmount =
          !amount || amount === '0'
            ? await this.blockchainService.getAssetTokenBalance(
                tokenAddress,
                request.oldWallet,
              )
            : amount;

        txHash = await this.blockchainService.executeWalletRecovery(
          tokenAddress,
          request.oldWallet,
          newWallet,
          resolvedAmount,
        );
      } else {
        const investorProfile = await this.userRepo.manager
          .getRepository('InvestorProfile')
          .findOne({ where: { user: { id: request.userId } } });

        if (!investorProfile) {
          throw new BadRequestException(
            'No investor profile found for this user to locate asset ownerships.',
          );
        }

        const ownerships = await this.userRepo.manager
          .getRepository(Ownership)
          .find({
            where: { investorId: (investorProfile as any).id },
            relations: ['asset'],
          });

        if (!ownerships || ownerships.length === 0) {
          throw new BadRequestException(
            'No asset ownership records found for this investor.',
          );
        }

        for (const ownership of ownerships) {
          const resolvedTokenAddress = (ownership.asset as any)?.tokenAddress;
          if (!resolvedTokenAddress) continue;

          const tokenBalance =
            await this.blockchainService.getAssetTokenBalance(
              resolvedTokenAddress,
              request.oldWallet,
            );

          if (BigInt(tokenBalance) > 0n) {
            txHash = await this.blockchainService.executeWalletRecovery(
              resolvedTokenAddress,
              request.oldWallet,
              newWallet,
              tokenBalance,
            );
          }
        }

        if (!txHash) {
          throw new BadRequestException(
            'Found ownership records, but all token balances in the old wallet were zero.',
          );
        }
      }

      await this.userRepo.update(
        { id: request.userId },
        { walletAddress: newWallet },
      );

      request.txHash = txHash;
      request.status = RecoveryStatus.COMPLETED;
      request.completedAt = new Date();
      const savedRequest = await this.recoveryRepo.save(request);

      // 🛡️ NOTIFICATION: Inform user recovery completed successfully
      try {
        await this.notificationOrchestrator.buildAndSave(
          request.userId,
          'recovery.completed',
          {
            title: 'Wallet Recovery Successful',
            message:
              'Your wallet has been successfully recovered and assets have been transferred to your new address.',
            requestId: request.id,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send recovery success notification: ${err}`,
        );
      }

      return savedRequest;
    } catch (error: any) {
      if (request.newWallet && request.newWallet !== 'dummy') {
        await this.userRepo
          .update({ id: request.userId }, { walletAddress: request.newWallet })
          .catch(() => {});
      }

      request.status = RecoveryStatus.REJECTED;
      await this.recoveryRepo.save(request);

      // 🛡️ NOTIFICATION: Inform user recovery failed
      try {
        await this.notificationOrchestrator.buildAndSave(
          request.userId,
          'recovery.failed',
          {
            title: 'Wallet Recovery Failed',
            message: `On-chain recovery execution failed: ${error.message}`,
            requestId: request.id,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send recovery failure notification: ${err}`,
        );
      }

      throw new BadRequestException(
        `On-chain recovery execution failed: ${error.message}`,
      );
    }
  }

  async getRequestsByUser(userId: string): Promise<RecoveryRequestEntity[]> {
    return this.recoveryRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getAllRequestsForAdmin(): Promise<any[]> {
    const requests = await this.recoveryRepo.find({
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      requests.map(async (req) => {
        let investorProfileId: string | null = null;
        let user: { id: string; name?: string; email?: string } | null = null;

        if (req.userId) {
          user = await this.userRepo.findOne({
            where: { id: req.userId },
            select: ['id', 'name', 'email'],
          });

          const investorProfile = await this.userRepo.manager
            .getRepository('InvestorProfile')
            .findOne({
              where: { user: { id: req.userId } },
              select: ['id'],
            });

          if (investorProfile) {
            investorProfileId = (investorProfile as any).id;
          }
        }

        return {
          ...req,
          investorProfileId: investorProfileId || req.userId,
          user: user || { id: req.userId, name: 'Unknown', email: '' },
        };
      }),
    );
  }

  async submitVerification(
    userId: string,
    data: {
      requestId: string;
      documentType: string;
      documentFile?: Express.Multer.File | null;
      selfieFile?: Express.Multer.File | null;
      phoneOtp?: string;
      emailOtp?: string;
    },
  ) {
    const request = await this.recoveryRepo.findOne({
      where: { id: data.requestId, userId },
    });

    if (!request) {
      throw new NotFoundException('Recovery request not found');
    }

    let documentUrl: string | null = null;
    let selfieUrl: string | null = null;

    try {
      if (data.documentFile) {
        documentUrl = await this.storageService.uploadFile(
          data.documentFile,
          'recovery/documents',
        );
      }
      if (data.selfieFile) {
        selfieUrl = await this.storageService.uploadFile(
          data.selfieFile,
          'recovery/selfies',
        );
      }
    } catch (error) {
      console.error('Recovery S3 Upload Failed:', error);
      throw new InternalServerErrorException(
        'Failed to upload verification files.',
      );
    }

    request.status = RecoveryStatus.UNDER_REVIEW;

    const uploadedFiles = [documentUrl, selfieUrl].filter(Boolean) as string[];
    request.documentUrls = uploadedFiles;

    await this.recoveryRepo.save(request);

    // 🛡️ NOTIFICATION: Inform user recovery verification package submitted
    try {
      await this.notificationOrchestrator.buildAndSave(
        userId,
        'recovery.submitted',
        {
          title: 'Recovery Documents Submitted',
          message:
            'Your verification package has been uploaded and is now under review by administrators.',
          requestId: request.id,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to send recovery submission notification: ${err}`,
      );
    }

    return {
      success: true,
      message:
        'Verification package successfully processed and submitted for review.',
      status: RecoveryStatus.UNDER_REVIEW,
    };
  }
}
