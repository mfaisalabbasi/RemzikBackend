import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  Get,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt.gaurd';
import { UserService } from '../user/user.service'; // Ensure this import exists

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService, // Injected UserService
  ) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);

    res.cookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: false, // Set to true in production
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24,
    });

    return {
      user: result.user, // result.user now includes KYC from our previous AuthService update
      message: 'Login successful',
    };
  }

  /**
   * UPDATED: Now fetches the full user from the DB using the ID from the JWT.
   * This ensures 'kyc' data is present for the frontend alert.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: Request & { user?: any }) {
    const userId = req.user?.userId;

    // 1. Fetch the user
    const fullUser = await this.userService.getMe(userId);

    // 2. Safety Check: If for some reason the DB record is missing
    if (!fullUser) {
      throw new UnauthorizedException('User profile no longer exists');
    }

    // 3. Now TypeScript knows fullUser is NOT null
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
      secure: false,
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }
}
