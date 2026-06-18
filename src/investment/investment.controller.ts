import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  Inject,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { InvestmentService } from './investment.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { KycGuard } from 'src/auth/guards/kyc.guard';
import { getQueueToken } from '@nestjs/bull';
import type { Queue } from 'bull';
import type { CreateInvestmentDto } from './dto/create-investment.dto';
import { CreateInvestmentDto as CreateInvestmentDtoClass } from './dto/create-investment.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('investments')
export class InvestmentController {
  constructor(
    private readonly investmentService: InvestmentService,
    @Inject(getQueueToken('investment-queue'))
    private readonly investmentQueue: Queue,
  ) {}

  @Post()
  @UseGuards(KycGuard)
  @Roles(UserRole.INVESTOR)
  async create(@Req() req: any, @Body() dto: CreateInvestmentDtoClass) {
    // CIRCUIT BREAKER: Fail-Fast if Redis is unresponsive
    try {
      await Promise.race([
        this.investmentQueue.client.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('REDIS_TIMEOUT')), 800),
        ),
      ]);
    } catch (e) {
      throw new HttpException(
        'Investment service is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return this.investmentService.createInvestment(
      req.user.userId,
      dto as CreateInvestmentDto,
    );
  }

  @Patch(':id/confirm')
  @Roles(UserRole.ADMIN)
  confirm(@Param('id') id: string) {
    return this.investmentService.confirmInvestment(id);
  }

  @Get('me')
  @Roles(UserRole.INVESTOR)
  getMy(@Req() req: any) {
    return this.investmentService.getMyInvestments(req.user.userId);
  }
}
