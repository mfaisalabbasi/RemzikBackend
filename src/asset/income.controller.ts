import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { IncomeService } from './income.service';
import { CreateIncomeDto } from './dto/create-income.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
@Controller('assets/income')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  /**
   * ✅ FIXED: Added JwtAuthGuard to populate req.user
   */
  @UseGuards(JwtAuthGuard)
  @Post('report')
  async submitReport(@Request() req, @Body() dto: CreateIncomeDto) {
    // req.user is now guaranteed to exist because of the Guard
    const partnerUserId = req.user.id;
    return await this.incomeService.createReport(partnerUserId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':assetId/history')
  async getHistory(@Param('assetId') assetId: string) {
    return await this.incomeService.getAssetHistory(assetId);
  }
}
