import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  Get,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt.gaurd';
import { UserService } from '../user/user.service';
import * as crypto from 'crypto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  /**
   * Public JWKS Endpoint
   * Flat route to avoid NestJS routing conflicts with dots and slashes.
   * Accessible via: http://localhost:4000/auth/jwks (or /api/auth/jwks if global prefix is active)
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

    // Convert the clean public PEM string into a standard JWK component
    const keyObject = crypto.createPublicKey(
      publicKeyPem.replace(/\\n/g, '\n'),
    );
    const jwk = keyObject.export({ format: 'jwk' });

    // Returns the exact compliant key set structure Privy demands
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

    return {
      id: fullUser.id,
      email: fullUser.email,
      phone: fullUser.phone,
      role: fullUser.role,
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
}
