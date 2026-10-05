import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const cookieOrHeaderExtractor = (req: Request): string | null => {
  // 1. Check for token in cookies (used by Web)
  if (req && req.cookies && req.cookies['accessToken']) {
    return req.cookies['accessToken'];
  }

  // 2. Fallback: Check for token in Authorization Bearer header (used by Mobile App)
  const authHeader = req?.headers?.authorization;
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    if (type === 'Bearer' && token) {
      return token;
    }
  }

  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieOrHeaderExtractor]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: false,
    });
  }

  async validate(payload: any) {
    // We include isActive so the KycGuard can check the global kill-switch
    return {
      userId: payload.sub,
      role: payload.role,
      isActive: payload.isActive,
    };
  }
}
