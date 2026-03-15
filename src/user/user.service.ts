import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';

import * as bcrypt from 'bcrypt';

import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from './enums/user-role.enum';

import { PartnerService } from '../partner/partner.service';
import { InvestorService } from '../investor/investor.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,

    private partnerService: PartnerService,
    private investorService: InvestorService,
  ) {}

  async register(dto: CreateUserDto, res: Response): Promise<any> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already exists');

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = this.userRepo.create({
      email,
      name: dto.name,
      phone: dto.phone,
      password: hashedPassword,
      role: dto.role ?? UserRole.INVESTOR,
    });

    const savedUser = await this.userRepo.save(user);

    /**
     * AUTO PROFILE CREATION
     */
    if (savedUser.role === UserRole.PARTNER) {
      await this.partnerService.createProfile(savedUser.id, {
        companyName: 'Pending Company',
      });
    }

    if (savedUser.role === UserRole.INVESTOR) {
      await this.investorService.createProfile(savedUser.id);
    }

    const payload = {
      sub: savedUser.id,
      role: savedUser.role,
    };

    const token = this.jwtService.sign(payload);

    res.cookie('accessToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // true in production
    });

    return {
      message: 'User created successfully',
      user: {
        id: savedUser.id,
        email: savedUser.email,
        role: savedUser.role,
      },
    };
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    return user;
  }
}
