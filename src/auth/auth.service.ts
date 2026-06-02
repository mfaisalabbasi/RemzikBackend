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

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
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

    // 1. Construct a fully standard compliant OpenID JWT payload
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

    // 2. JWT Header containing the exact Key ID matching your JWKS distribution
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: process.env.PRIVY_KEY_ID || 'remzik-static-key-v1',
    };

    const encodedHeader = base64UrlEncode(header);
    const encodedPayload = base64UrlEncode(payload);
    const tokenData = `${encodedHeader}.${encodedPayload}`;

    // 3. Extract the permanent private signing key from environment configurations
    const privateKeyInput = process.env.PRIVY_PRIVATE_KEY;
    if (!privateKeyInput) {
      throw new Error(
        'Server misconfiguration: PRIVY_PRIVATE_KEY environment variable is missing.',
      );
    }

    // 4. Create the cryptographic signature natively using RSA-SHA256 engine
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(tokenData);

    const signature = sign
      .sign(
        privateKeyInput.replace(/\\n/g, '\n'), // Safely processes text explicit breaks
        'base64',
      )
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const token = `${tokenData}.${signature}`;

    return { token };
  }
}
