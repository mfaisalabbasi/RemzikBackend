// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  Get,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt.gaurd';
import { UserService } from '../user/user.service';
import * as crypto from 'crypto';
import { WalletProvisionService } from './wallet-provision.service';
import { ethers } from 'ethers';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly walletProvisionService: WalletProvisionService,
  ) {}

  /**
   * Public JWKS Endpoint
   * Flat route to avoid NestJS routing conflicts with dots and slashes.
   */
  @Get('jwks')
  @HttpCode(HttpStatus.OK)
  getJwks() {
    const publicKeyPem = process.env.PRIVY_PUBLIC_KEY;
    const kid = process.env.PRIVY_KEY_ID || 'remzik-static-key-v1';

    if (!publicKeyPem) {
      throw new Error(
        'Server misconfiguration: PRIVY_PUBLIC_KEY environment variable is missing.',
      );
    }

    const keyObject = crypto.createPublicKey(
      publicKeyPem.replace(/\\n/g, '\n'),
    );
    const jwk = keyObject.export({ format: 'jwk' });

    return {
      keys: [
        {
          kty: jwk.kty,
          n: jwk.n,
          e: jwk.e,
          alg: 'RS256',
          use: 'sig',
          kid: kid,
        },
      ],
    };
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);

    res.cookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24,
    });

    return {
      accessToken: result.accessToken,
      user: result.user,
      message: 'Login successful',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: Request & { user?: any }) {
    const userId = req.user?.userId;
    const fullUser = await this.userService.getMe(userId);

    if (!fullUser) {
      throw new UnauthorizedException('User profile no longer exists');
    }

    // 🚀 Included 'name', 'walletAddress', and 'isVerified' to match your entity schema fully
    return {
      id: fullUser.id,
      name: fullUser.name,
      email: fullUser.email,
      phone: fullUser.phone,
      role: fullUser.role,
      walletAddress: fullUser.walletAddress,
      isVerified: fullUser.isVerified,
      kyc: fullUser.kyc,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('privy-token')
  async getPrivyToken(@Req() req: Request & { user?: any }) {
    const userId = req.user?.userId;
    const { token } = await this.authService.generatePrivyToken(userId);

    return {
      privyCustomToken: token,
      jwk: null,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-wallet')
  async syncWallet(
    @Req() req: Request & { user?: any },
    @Body()
    body: {
      walletAddress: string;
      privyUserId: string;
    },
  ) {
    const userId = req.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Authenticated user not found.');
    }

    if (!body?.walletAddress || !ethers.isAddress(body.walletAddress)) {
      throw new BadRequestException('Invalid wallet address.');
    }

    if (!body?.privyUserId) {
      throw new BadRequestException('Privy user ID is required.');
    }

    const result = await this.walletProvisionService.syncPrivyWallet(
      userId,
      body.walletAddress,
      body.privyUserId,
    );

    return {
      success: true,
      walletAddress: result.walletAddress,
      privyUserId: result.privyUserId,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('provision-wallet')
  async provisionWallet(@Req() req: Request & { user?: any }) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user not found.');
    }

    const result =
      await this.walletProvisionService.provisionMobileWallet(userId);

    return {
      success: true,
      walletAddress: result.walletAddress,
      privyUserId: result.privyUserId,
    };
  }
}
