import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { DisputeStatus } from '../dispute.enums';

export class ResolveDisputeDto {
  @IsEnum(DisputeStatus)
  @IsNotEmpty()
  status: DisputeStatus; // Standardizing the final state of the dispute

  @IsUUID()
  @IsNotEmpty()
  disputeId: string; // Ensures the target is a valid unique identifier

  @IsString()
  @IsNotEmpty()
  action: 'APPROVE' | 'REJECT'; // The command that triggers financial movement

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string; // Brief reason for the claimant's visibility

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string; // Detailed internal note for institutional audit trails
}
