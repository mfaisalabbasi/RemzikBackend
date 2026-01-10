import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  phone: string;

  @MinLength(8)
  password: string;
  @MinLength(2)
  role: string;
}
