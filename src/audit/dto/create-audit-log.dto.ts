import { IsEnum, IsString, IsOptional } from 'class-validator';
import { AuditActor } from '../enums/audit-actor.enum';
import { AuditAction } from '../enums/audit-action.enum';

export class CreateAuditLogDto {
  @IsEnum(AuditActor)
  actorType: AuditActor;

  @IsString()
  actorId: string;

  @IsEnum(AuditAction)
  action: AuditAction;

  @IsString()
  targetType: string;

  @IsString()
  targetId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
