import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
} from 'class-validator';

import { Type } from 'class-transformer';

import { AssetType } from '../enums/asset-type.enum';

export class CreateAssetDto {
  @IsEnum(AssetType)
  type: AssetType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @Type(() => Number)
  @IsNumber()
  totalValue: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedYield?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rentalIncome?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  assetSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tokenSupply?: number;
}
