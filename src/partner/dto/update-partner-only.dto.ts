import { IsString } from 'class-validator';

export class UpdatePartnerCompanyDto {
  @IsString()
  companyName: string;
}
