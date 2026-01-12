import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

// Define the shape of your token payload
interface JwtPayload {
  sub: string;
  role: string;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Ensure the secret is loaded from environment variables
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * This method is called after the JWT is successfully decoded and verified.
   * The object returned here is attached to the Request object as 'req.user'.
   */
  async validate(payload: JwtPayload) {
    // Check if the payload contains the necessary claims
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Malformed token payload');
    }

    return {
      userId: payload.sub,
      role: payload.role,
    };
  }
}
