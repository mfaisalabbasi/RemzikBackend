import { IsOptional, IsString, IsEnum } from 'class-validator';
import { PartnerStatus } from '../enums/partner-status.enum';

export class UpdatePartnerProfileDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  /**
   * Admin-only field
   */
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;
}
