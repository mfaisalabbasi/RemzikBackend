import { IsNotEmpty, IsString } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class RegisterWithKycDto extends CreateUserDto {
  @IsNotEmpty()
  @IsString()
  fullName: string; // The legal name for KYC purposes

  @IsNotEmpty()
  @IsString()
  dob: string; // Date of Birth
}
