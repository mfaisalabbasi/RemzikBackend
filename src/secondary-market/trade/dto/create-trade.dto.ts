import { IsString, IsNumber, IsPositive } from 'class-validator';

export class CreateTradeDto {
  @IsString()
  assetId: string;

  @IsNumber()
  @IsPositive()
  units: number;

  @IsNumber()
  @IsPositive()
  pricePerUnit: number;
}
