import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { DisputeType } from '../dispute.enums';

export class CreateDisputeDto {
  @IsEnum(DisputeType)
  type: DisputeType;

  @IsString()
  @IsNotEmpty()
  referenceId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
