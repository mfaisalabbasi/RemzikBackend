import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  BadRequestException,
  Param,
} from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  // This handles POST /api/disputes
  @Post()
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateDisputeDto,
  ) {
    if (!userId) throw new BadRequestException('Invalid user session');
    return await this.disputeService.createDispute(userId, dto);
  }

  // ADD THIS: This handles GET /api/disputes
  @Get()
  async findAll(@CurrentUser('userId') userId: string) {
    // You can decide if this returns ALL disputes (for admins)
    // or just the user's disputes.
    return await this.disputeService.getUserDisputes(userId);
  }

  // This handles GET /api/disputes/my-disputes
  @Get('my-disputes')
  async getUserDisputes(@CurrentUser('userId') userId: string) {
    return await this.disputeService.getUserDisputes(userId);
  }

  // Add these to DisputeController

  // GET /api/disputes/admin/all
  @Get('admin/all')
  // Ensure you have an AdminGuard or check roles here
  async getAllDisputes() {
    return await this.disputeService.getAllDisputes();
  }

  // POST /api/disputes/:id/resolve
  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return await this.disputeService.resolveDispute(id, adminId, dto);
  }
}
