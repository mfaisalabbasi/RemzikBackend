import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  Get,
  Req,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt.gaurd';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);

    // Set cookie with explicit root path
    res.cookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: false, // Set to true in Production with HTTPS
      sameSite: 'lax',
      path: '/', // 👈 Set here
      maxAge: 1000 * 60 * 60 * 24,
    });

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        phone: result.user.phone,
        role: result.user.role,
      },
      message: 'Login successful',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: Request & { user?: any }) {
    return {
      id: req.user?.userId,
      role: req.user?.role,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    // ✅ THE FIX: Path must match the login path to be cleared
    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/', // 👈 REQUIRED to delete the root cookie
    });

    return { message: 'Logged out successfully' };
  }
}
