import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { TokenizationService } from './tokenization.service';
import { CreateTokenizationDto } from './dto/create-tokenization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.gaurd';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/enums/user-role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tokenization')
export class TokenizationController {
  constructor(private readonly service: TokenizationService) {}

  @Post(':assetId')
  @Roles(UserRole.ADMIN)
  tokenize(
    @Param('assetId') assetId: string,
    @Body() dto: CreateTokenizationDto,
  ) {
    return this.service.tokenizeAsset(assetId, dto);
  }
}
