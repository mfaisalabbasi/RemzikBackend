import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';

import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterWithKycDto } from './dto/register-with-kyc.dto';
import { UserRole } from './enums/user-role.enum';
import { KycProfile } from '../kyc/kyc.entity';
import { KycStatus } from '../kyc/enums/kyc-status.enum';

import { PartnerService } from '../partner/partner.service';
import { InvestorService } from '../investor/investor.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private dataSource: DataSource,
    private partnerService: PartnerService,
    private investorService: InvestorService,
    private storageService: StorageService,
  ) {}

  async registerWithKyc(
    dto: RegisterWithKycDto,
    files: any,
    res: Response,
  ): Promise<any> {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone.trim();

    // 1. ROLE SECURITY GUARD
    if (dto.role === UserRole.ADMIN) {
      throw new BadRequestException('Unauthorized role selection.');
    }

    const existing = await this.userRepo.findOne({
      where: [{ email }, { phone }],
    });
    if (existing) {
      throw new BadRequestException('Email or Phone number already exists');
    }

    // 2. ATOMIC FILE UPLOAD
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

    // 3. DATABASE TRANSACTION
    try {
      return await this.dataSource.transaction(
        async (manager: EntityManager) => {
          // Create User
          const user = manager.create(User, {
            email,
            name: dto.name,
            phone: phone,
            password: hashedPassword,
            role: (dto.role as UserRole) ?? UserRole.INVESTOR,
          });
          const savedUser = await manager.save(user);

          // Create Role Profile
          if (savedUser.role === UserRole.PARTNER) {
            await this.partnerService.createProfile(
              savedUser.id,
              { companyName: 'Remzik Partner' },
              manager,
            );
          } else if (savedUser.role === UserRole.INVESTOR) {
            await this.investorService.createProfile(savedUser.id, manager);
          }

          // Create KYC Record (Direct Instantiation to solve Overload Error)
          const kyc = new KycProfile();
          kyc.fullName = dto.fullName;
          kyc.dob = dto.dob;
          kyc.idDocumentUrl = idDocumentUrl!;
          kyc.addressProofUrl = addressProofUrl!;
          kyc.status = KycStatus.PENDING;
          kyc.user = savedUser;

          await manager.save(kyc);

          // Token & Cookie
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
    } catch (error) {
      // 4. CRITICAL S3 CLEANUP ON DB FAILURE
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
    // Add relations here to fetch the KYC data
    const user = await this.userRepo.findOne({
      where: { email },
      relations: ['kyc'], // <--- CRITICAL FIX
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
}
