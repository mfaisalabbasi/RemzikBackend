// src/investments/dto/create-investment.dto.ts
import { IsNotEmpty, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateInvestmentDto {
  @IsUUID()
  @IsNotEmpty()
  assetId!: string;

  @IsNumber()
  @Min(1)
  amount!: number;

  @IsNotEmpty()
  @IsUUID()
  transactionId!: string;
}
