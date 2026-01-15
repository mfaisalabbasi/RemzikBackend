import {
  IsEmail,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
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

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
