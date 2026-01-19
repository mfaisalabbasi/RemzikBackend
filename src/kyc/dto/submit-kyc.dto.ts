import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitKycDto {
  @IsString()
  @IsNotEmpty()
  documentNumber: string;

  @IsString()
  @IsNotEmpty()
  country: string;
}
