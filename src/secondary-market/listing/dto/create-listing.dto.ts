import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  IsOptional,
  IsDateString,
  IsString,
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

  @IsString()
  approvalTxHash: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
