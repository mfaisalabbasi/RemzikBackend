import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InvestmentService } from './investment.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { KycGuard } from 'src/auth/guards/kyc.guard';

@UseGuards(JwtAuthGuard, RolesGuard, KycGuard)
@Controller('investments')
export class InvestmentController {
  constructor(private readonly investmentService: InvestmentService) {}

  /**
   * INVESTOR invests
   */
  @Post()
  @Roles(UserRole.INVESTOR)
  create(@Req() req, @Body() dto: CreateInvestmentDto) {
    return this.investmentService.createInvestment(req.user.userId, dto);
  }

  /**
   * ADMIN confirms payment
   */
  // @Patch(':id/confirm')
  // @Roles(UserRole.ADMIN)
  // confirm(@Param('id') id: string) {
  //   return this.investmentService.confirmInvestment(id);
  // }

  /**
   * INVESTOR portfolio
   */
  @Get('me')
  @Roles(UserRole.INVESTOR)
  getMy(@Req() req) {
    return this.investmentService.getMyInvestments(req.user.userId);
  }
}
