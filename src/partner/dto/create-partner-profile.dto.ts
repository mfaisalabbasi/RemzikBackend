import { IsNotEmpty, IsString } from 'class-validator';

export class CreatePartnerProfileDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;
}
