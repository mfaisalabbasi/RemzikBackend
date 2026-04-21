import {
  IsString,
  IsEnum,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';
import { BroadcastTarget } from '../enums/broadcast-target.enum';

export class CreateBroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(100)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  message: string;

  @IsEnum(BroadcastTarget)
  target: BroadcastTarget;
}
