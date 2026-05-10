import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const cookieExtractor = (req: Request): string | null => {
  if (req && req.cookies) {
    return req.cookies['accessToken'] || null;
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
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
