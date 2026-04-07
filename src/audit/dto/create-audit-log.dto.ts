import { IsEnum, IsString, IsOptional } from 'class-validator';
import { AuditActor } from '../enums/audit-actor.enum';
// 🛡️ FIX: Import 'AdminAction' because that is the exported name in your enum file
import { AdminAction } from '../enums/audit-action.enum';

export class CreateAuditLogDto {
  @IsEnum(AuditActor)
  actorType: AuditActor;

  @IsString()
  actorId: string;

  // 🛡️ FIX: Use 'AdminAction' here to match the import
  @IsEnum(AdminAction)
  action: AdminAction;

  @IsString()
  targetType: string;

  @IsString()
  targetId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
