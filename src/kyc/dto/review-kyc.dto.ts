import { IsEnum } from 'class-validator';
import { KycStatus } from '../enums/kyc-status.enum';

export class ReviewKycDto {
  @IsEnum(KycStatus)
  status: KycStatus;
}
