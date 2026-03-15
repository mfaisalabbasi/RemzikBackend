import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitKycDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  dob: string;
}
