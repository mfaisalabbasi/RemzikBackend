import { IsEmail, IsNotEmpty, MinLength, IsEnum } from 'class-validator';
import { UserRole } from '../enums/user-role.enum';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @MinLength(3)
  name: string;

  @IsNotEmpty()
  phone: string;

  @MinLength(8)
  password: string;

  @IsEnum(UserRole, { message: 'Role must be one of INVESTOR, PARTNER, ADMIN' })
  role: UserRole; // ✅ required now
}
