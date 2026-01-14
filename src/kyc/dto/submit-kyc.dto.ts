import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitKycDto {
  @IsString()
  @IsNotEmpty()
  documentNumber: string;

  @IsString()
  @IsNotEmpty()
  country: string;
}
