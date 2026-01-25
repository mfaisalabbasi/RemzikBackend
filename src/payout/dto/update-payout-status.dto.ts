import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { PayoutStatus } from '../enums/payout-status.enum';

export class UpdatePayoutStatusDto {
  @IsEnum(PayoutStatus)
  status: PayoutStatus;

  @IsOptional()
  @IsString()
  reason?: string; // <-- add this field
}
