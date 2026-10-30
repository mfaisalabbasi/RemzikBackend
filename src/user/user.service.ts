// src/user/user.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import * as nodemailer from 'nodemailer';

import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterWithKycDto } from './dto/register-with-kyc.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

import { UserRole } from './enums/user-role.enum';
import { KycProfile } from '../kyc/kyc.entity';
import { KycStatus } from '../kyc/enums/kyc-status.enum';

import { PartnerService } from '../partner/partner.service';
import { InvestorService } from '../investor/investor.service';
import { StorageService } from '../storage/storage.service';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private dataSource: DataSource,
    private partnerService: PartnerService,
    private investorService: InvestorService,
    private storageService: StorageService,
    private notificationOrchestrator: NotificationOrchestrator,
  ) {}

  async registerWithKyc(
    dto: RegisterWithKycDto,
    files: any,
    res: Response,
  ): Promise<any> {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone.trim();

    if (dto.role === UserRole.ADMIN) {
      throw new BadRequestException('Unauthorized role selection.');
    }

    const existing = await this.userRepo.findOne({
      where: [{ email }, { phone }],
    });
    if (existing) {
      throw new BadRequestException('Email or Phone number already exists');
    }

    let idDocumentUrl: string | null = null;
    let addressProofUrl: string | null = null;

    try {
      if (files?.idDocument?.[0]) {
        idDocumentUrl = await this.storageService.uploadFile(
          files.idDocument[0],
          'kyc/ids',
        );
      }
      if (files?.addressProof?.[0]) {
        addressProofUrl = await this.storageService.uploadFile(
          files.addressProof[0],
          'kyc/address',
        );
      }
    } catch (error) {
      console.error('S3 Upload Failed:', error);
      throw new InternalServerErrorException('Failed to upload KYC documents.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    let savedUserId: string | null = null;

    try {
      const result = await this.dataSource.transaction(
        async (manager: EntityManager) => {
          const user = manager.create(User, {
            email,
            name: dto.name,
            phone: phone,
            password: hashedPassword,
            role: (dto.role as UserRole) ?? UserRole.INVESTOR,
          });
          const savedUser = await manager.save(user);
          savedUserId = savedUser.id;

          if (savedUser.role === UserRole.PARTNER) {
            await this.partnerService.createProfile(
              savedUser.id,
              { companyName: 'Remzik Partner' },
              manager,
            );
          } else if (savedUser.role === UserRole.INVESTOR) {
            await this.investorService.createProfile(savedUser.id, manager);
          }

          const kyc = new KycProfile();
          kyc.fullName = dto.fullName;
          kyc.dob = dto.dob;
          kyc.idDocumentUrl = idDocumentUrl!;
          kyc.addressProofUrl = addressProofUrl!;
          kyc.status = KycStatus.PENDING;
          kyc.user = savedUser;

          await manager.save(kyc);

          const payload = { sub: savedUser.id, role: savedUser.role };
          const token = this.jwtService.sign(payload);

          res.cookie('accessToken', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          });

          return {
            message: 'Account and KYC submitted successfully',
            user: {
              id: savedUser.id,
              email: savedUser.email,
              role: savedUser.role,
            },
          };
        },
      );

      if (savedUserId) {
        try {
          await this.notificationOrchestrator.buildAndSave(
            savedUserId,
            'user.registered',
            {
              title: 'Account Registered & KYC Submitted',
              message:
                'Your account has been created and your verification documents are under review.',
              timestamp: new Date(),
            },
          );
        } catch (err) {
          this.logger.error(`Failed to send registration notification: ${err}`);
        }
      }

      return result;
    } catch (error) {
      console.error('Transaction Failed, cleaning up storage...');

      const cleanupTasks: Promise<void>[] = [];
      if (idDocumentUrl)
        cleanupTasks.push(this.storageService.deleteFile(idDocumentUrl));
      if (addressProofUrl)
        cleanupTasks.push(this.storageService.deleteFile(addressProofUrl));

      await Promise.all(cleanupTasks);

      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Registration failed. Storage cleaned up.',
      );
    }
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { email },
      relations: ['kyc'],
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    return user;
  }

  async register(dto: CreateUserDto, res: Response): Promise<any> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already exists');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      ...dto,
      email,
      password: hashedPassword,
    });
    const savedUser = await this.userRepo.save(user);

    const payload = { sub: savedUser.id, role: savedUser.role };
    const token = this.jwtService.sign(payload);

    res.cookie('accessToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    try {
      await this.notificationOrchestrator.buildAndSave(
        savedUser.id,
        'user.registered',
        {
          title: 'Welcome to Remzik!',
          message: 'Your account has been created successfully.',
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send registration notification: ${err}`);
    }

    return {
      message: 'User created successfully',
      user: { id: savedUser.id, email: savedUser.email, role: savedUser.role },
    };
  }

  async getMe(userId: string) {
    return await this.userRepo.findOne({
      where: { id: userId },
      relations: ['kyc'],
    });
  }

  async syncWalletAddress(
    userId: string,
    walletAddress: string,
    privyUserId?: string,
  ): Promise<any> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User profile no longer exists');
    }

    const existingWalletOwner = await this.userRepo.findOne({
      where: { walletAddress },
    });

    if (existingWalletOwner && existingWalletOwner.id !== userId) {
      throw new BadRequestException(
        'This wallet address is already linked to another account',
      );
    }

    user.walletAddress = walletAddress;
    if (privyUserId) {
      user.privyUserId = privyUserId;
    }

    await this.userRepo.save(user);

    try {
      await this.notificationOrchestrator.buildAndSave(
        userId,
        'user.wallet_linked',
        {
          title: 'Wallet Connected',
          message:
            'Your cryptographic wallet has been successfully anchored to your profile.',
          walletAddress,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send wallet link notification: ${err}`);
    }

    return {
      message:
        'Cryptographic wallet and Privy identity anchored to profile successfully',
      walletAddress: user.walletAddress,
      privyUserId: user.privyUserId,
    };
  }

  async updateFcmToken(userId: string, fcmToken: string): Promise<any> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User profile no longer exists');
    }

    user.fcmToken = fcmToken;
    await this.userRepo.save(user);

    return {
      message: 'FCM token updated successfully',
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<any> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User profile no longer exists');
    }

    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Incorrect current password');
    }

    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);

    try {
      await this.notificationOrchestrator.buildAndSave(
        userId,
        'auth.password_changed',
        {
          title: 'Master Password Updated',
          message: 'Your account master password was changed successfully.',
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send password change notification: ${err}`);
    }

    return {
      success: true,
      message: 'Password updated successfully',
    };
  }

  async forgotPassword(email: string): Promise<any> {
    const formattedEmail = email.trim().toLowerCase();
    const user = await this.userRepo.findOne({
      where: { email: formattedEmail },
    });

    if (!user) {
      return {
        success: true,
        message: 'If an account exists, a reset code has been sent.',
      };
    }

    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedToken = createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await this.userRepo.save(user);

    // 1. In-App Notification
    try {
      await this.notificationOrchestrator.buildAndSave(
        user.id,
        'auth.forgot_password',
        {
          title: 'Password Reset Code',
          message: `Your verification code for password reset is: ${resetToken}`,
          resetCode: resetToken,
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send reset code notification: ${err}`);
    }

    // 2. Dispatch Email to User Gmail Inbox via Nodemailer
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT) || 465,
          secure: true,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: `"Remzik Protocol" <${process.env.SMTP_USER}>`,
          to: user.email,
          subject: 'Your Password Reset Verification Code',
          text: `Your password reset code is: ${resetToken}. It will expire in 15 minutes.`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #020B07; color: #F0FDF4; border-radius: 10px;">
              <h2 style="color: #34D399;">Password Reset Verification</h2>
              <p>You requested to reset your password. Use the verification code below:</p>
              <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #34D399; margin: 20px 0;">
                ${resetToken}
              </div>
              <p style="color: #94A3B8; font-size: 12px;">This code will expire in 15 minutes. If you did not request this, please ignore this email.</p>
            </div>
          `,
        });
        this.logger.log(`Password reset email dispatched to ${user.email}`);
      } catch (mailErr) {
        this.logger.error(`Failed to dispatch SMTP email: ${mailErr}`);
      }
    } else {
      this.logger.warn(
        `[DEVELOPMENT MODE] SMTP credentials not found in env. Raw Reset Code for ${user.email}: ${resetToken}`,
      );
    }

    return {
      success: true,
      message: 'If an account exists, a reset code has been sent.',
    };
  }

  async resetPassword(
    email: string,
    token: string,
    newPassword: string,
  ): Promise<any> {
    const formattedEmail = email.trim().toLowerCase();
    const hashedToken = createHash('sha256').update(token.trim()).digest('hex');

    const user = await this.userRepo.findOne({
      where: { email: formattedEmail },
    });

    if (!user) {
      throw new BadRequestException('Invalid email or verification code.');
    }

    if (
      !user.resetPasswordToken ||
      user.resetPasswordToken !== hashedToken ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires < new Date()
    ) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await this.userRepo.save(user);

    try {
      await this.notificationOrchestrator.buildAndSave(
        user.id,
        'auth.password_reset_success',
        {
          title: 'Password Reset Successful',
          message: 'Your account password was updated successfully.',
          timestamp: new Date(),
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send reset confirmation: ${err}`);
    }

    return {
      success: true,
      message: 'Password reset successfully.',
    };
  }
}
