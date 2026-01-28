import { IsUUID } from 'class-validator';

export class ExecuteTradeDto {
  @IsUUID()
  tradeId: string;

  @IsUUID()
  buyerId: string;
}
