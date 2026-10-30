import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @IsNotEmpty({ message: 'Reset token or code is required' })
  token: string;

  @MinLength(6, { message: 'New password must be at least 6 characters long' })
  @IsNotEmpty()
  newPassword: string;
}
