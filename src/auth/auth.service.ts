// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.userService.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const payload = {
      userId: user.id,
      sub: user.id,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    // 🚀 Included 'name', 'walletAddress', and 'isVerified' so login response matches /me
    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        walletAddress: user.walletAddress,
        isVerified: user.isVerified,
        kyc: user.kyc,
      },
    };
  }

  /**
   * Generates a temporary custom identity token for Privy verification
   * using a secure, permanent static private key configuration.
   */
  async generatePrivyToken(userId: string): Promise<{ token: string }> {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: 'remzik-backend',
      sub: userId,
      aud: 'remzik-app',
      iat: now,
      exp: now + 60 * 15, // Valid for 15 minutes
    };

    const base64UrlEncode = (obj: any) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: process.env.PRIVY_KEY_ID || 'remzik-static-key-v1',
    };

    const encodedHeader = base64UrlEncode(header);
    const encodedPayload = base64UrlEncode(payload);
    const tokenData = `${encodedHeader}.${encodedPayload}`;

    const privateKeyInput = process.env.PRIVY_PRIVATE_KEY;
    if (!privateKeyInput) {
      throw new Error(
        'Server misconfiguration: PRIVY_PRIVATE_KEY environment variable is missing.',
      );
    }

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(tokenData);

    const signature = sign
      .sign(privateKeyInput.replace(/\\n/g, '\n'), 'base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const token = `${tokenData}.${signature}`;

    return { token };
  }
}
