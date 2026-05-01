import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DisputeStatus } from '../dispute.enums';

export class ResolveDisputeDto {
  @IsEnum(DisputeStatus)
  status: DisputeStatus; // RESOLVED | REJECTED
  disputeId: string;
  action: 'APPROVE' | 'REJECT';
  reason?: string;
  @IsOptional()
  @IsString()
  adminNote?: string;
}
