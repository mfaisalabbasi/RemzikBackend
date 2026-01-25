import { IsNumber, Min } from 'class-validator';

export class CreatePayoutDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
