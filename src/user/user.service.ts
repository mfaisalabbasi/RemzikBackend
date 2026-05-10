import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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

    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already exists');

    // 1. Upload files to S3 first to get URLs
    let idDocumentUrl = 'pending';
    let addressProofUrl = 'pending';

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

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 2. Create User
        const user = manager.create(User, {
          email,
          name: dto.name,
          phone: dto.phone,
          password: hashedPassword,
          role: dto.role ?? UserRole.INVESTOR,
        });
        const savedUser = await manager.save(user);

        // 3. Create Role Profile
        if (savedUser.role === UserRole.PARTNER) {
          await this.partnerService.createProfile(
            savedUser.id,
            { companyName: 'Remzik Partner' },
            manager,
          );
        } else if (savedUser.role === UserRole.INVESTOR) {
          await this.investorService.createProfile(savedUser.id, manager);
        }

        // 4. Create KYC Record with S3 URLs
        const kyc = manager.create(KycProfile, {
          user: savedUser,
          fullName: dto.fullName,
          dob: dto.dob,
          idDocumentUrl: idDocumentUrl,
          addressProofUrl: addressProofUrl,
          status: KycStatus.PENDING,
        });
        await manager.save(kyc);

        // 5. Token & Cookie
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
      } catch (error) {
        console.error('Transaction Failed:', error);
        throw new InternalServerErrorException(
          'Registration failed. Everything rolled back.',
        );
      }
    });
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { email } });
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
    res.cookie('accessToken', token, { httpOnly: true, sameSite: 'lax' });
    return {
      message: 'User created successfully',
      user: { id: savedUser.id, email: savedUser.email, role: savedUser.role },
    };
  }
}
