import { IsNumber, IsUUID, Min } from 'class-validator';

export class CreateInvestmentDto {
  @IsUUID()
  assetId: string;

  @IsNumber()
  @Min(1)
  amount: number;
}
