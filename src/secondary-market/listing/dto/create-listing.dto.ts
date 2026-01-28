import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreateListingDto {
  @IsUUID()
  assetId: string;

  @IsNumber()
  @IsPositive()
  unitsForSale: number;

  @IsNumber()
  @IsPositive()
  pricePerUnit: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
