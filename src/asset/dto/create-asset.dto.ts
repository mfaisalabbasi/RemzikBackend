import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  Min,
} from 'class-validator';

import { Type } from 'class-transformer';
import { AssetType } from '../enums/asset-type.enum';

export class CreateAssetDto {
  @IsEnum(AssetType)
  type: AssetType;

  @IsString()
  @IsNotEmpty({ message: 'Title cannot be empty or blank spaces' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'Description cannot be empty or blank spaces' })
  description: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1, { message: 'Total value must be at least 1' })
  totalValue: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Expected yield cannot be negative' })
  expectedYield?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Rental income cannot be negative' })
  rentalIncome?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'Asset size must be greater than 0' })
  assetSize?: number;

  // ✅ MADE REQUIRED: Strict math guard needs this validated immediately
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1, { message: 'Token supply must be at least 1' })
  tokenSupply: number;
}
