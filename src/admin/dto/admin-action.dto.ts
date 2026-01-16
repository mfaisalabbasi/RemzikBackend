import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AdminAction } from '../enums/admin-action.enum';

export class AdminActionDto {
  @IsEnum(AdminAction)
  action: AdminAction;

  @IsOptional()
  @IsString()
  reason?: string;
}
