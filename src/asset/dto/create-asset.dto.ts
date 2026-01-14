import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
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

  @IsNumber()
  totalValue: number;
}
