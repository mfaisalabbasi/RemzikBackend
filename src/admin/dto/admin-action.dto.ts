// src/admin/dto/admin-action.dto.ts
import { IsEnum, IsUUID, IsOptional, IsString } from 'class-validator';
import { AdminAction } from '../enums/admin-action.enum';

export class AdminActionDto {
  @IsEnum(AdminAction)
  action: AdminAction;

  @IsUUID()
  targetId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
