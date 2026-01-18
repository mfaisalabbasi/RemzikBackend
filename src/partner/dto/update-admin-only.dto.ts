import { IsEnum } from 'class-validator';
import { PartnerStatus } from '../enums/partner-status.enum';

export class UpdatePartnerStatusDto {
  @IsEnum(PartnerStatus)
  status: PartnerStatus;
}
