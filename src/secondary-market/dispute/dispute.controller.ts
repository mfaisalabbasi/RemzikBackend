import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.gaurd';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  /**
   * USER: Raise a new concern
   */
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateDisputeDto) {
    return this.disputeService.createDispute(userId, dto);
  }

  /**
   * USER: View my history of concerns
   */
  @Get('my-disputes')
  getMy(@CurrentUser('userId') userId: string) {
    return this.disputeService.getUserDisputes(userId);
  }

  /**
   * ADMIN: View all active issues across Remzic
   */
  @Get('admin/all')
  getAll() {
    return this.disputeService.getAllDisputes();
  }

  /**
   * ADMIN: Resolve a dispute
   */
  @Patch('admin/resolve/:id')
  resolve(
    @Param('id') id: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputeService.resolveDispute(id, adminId, dto);
  }
}
