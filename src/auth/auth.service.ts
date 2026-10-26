import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { WalletProvisionService } from './wallet-provision.service';
import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private walletProvisionService: WalletProvisionService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationOrchestrator: NotificationOrchestrator,
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

    // 🛡️ NOTIFICATION: Inform user of login session
    try {
      await this.notificationOrchestrator.buildAndSave(user.id, 'auth.login', {
        title: 'New Login Detected',
        message: 'You have successfully signed into your account.',
        timestamp: new Date(),
      });
    } catch (err) {
      this.logger.error(`Failed to send login notification: ${err}`);
    }

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
   * 🛡️ Generates a custom JWT for Privy verification.
   * If the user doesn't have a privyUserId yet (new registration),
   * it provisions the wallet automatically on demand.
   */
  async generatePrivyToken(
    userId: string,
  ): Promise<{ token: string; walletAddress: string }> {
    let user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User profile not found.');
    }

    // 🚀 Self-Healing: Provision wallet automatically if missing during registration
    if (!user.privyUserId || !user.walletAddress) {
      this.logger.log(
        `ℹ️ [AuthService] Provisioning missing Privy wallet for user ${userId}...`,
      );
      const provisioned =
        await this.walletProvisionService.provisionMobileWallet(userId);
      user.privyUserId = provisioned.privyUserId;
      user.walletAddress = provisioned.walletAddress;
      await this.userRepository.save(user);

      // 🛡️ NOTIFICATION: Inform user wallet provisioned
      try {
        await this.notificationOrchestrator.buildAndSave(
          userId,
          'auth.wallet_provisioned',
          {
            title: 'Embedded Wallet Provisioned',
            message:
              'Your on-chain embedded wallet has been created successfully.',
            walletAddress: user.walletAddress,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send wallet provision notification: ${err}`,
        );
      }
    }

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: 'remzik-backend',
      sub: user.privyUserId, // 👈 Bound to Privy user ID
      aud: process.env.PRIVY_APP_ID || 'remzik-app',
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

    try {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(tokenData);

      const signature = sign
        .sign(privateKeyInput.replace(/\\n/g, '\n'), 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const token = `${tokenData}.${signature}`;
      return { token, walletAddress: user.walletAddress };
    } catch (error: any) {
      this.logger.error('❌ Failed to sign custom Privy token:', error);
      throw new InternalServerErrorException(
        'Could not generate secure session token: ' + (error.message || error),
      );
    }
  }
}
