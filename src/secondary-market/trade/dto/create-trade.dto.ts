import { IsUUID, IsNumber } from 'class-validator';

export class CreateTradeDto {
  @IsUUID()
  investmentId: string;

  @IsNumber()
  price: number;

  @IsUUID()
  sellerId: string;
}
