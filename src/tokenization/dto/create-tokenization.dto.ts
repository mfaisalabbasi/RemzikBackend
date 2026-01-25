import { IsInt, Min, IsNumber } from 'class-validator';

export class CreateTokenizationDto {
  @IsInt()
  @Min(1)
  totalShares: number;

  @IsNumber()
  @Min(1)
  sharePrice: number;
}
