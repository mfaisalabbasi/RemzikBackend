import {
  IsEnum,
  IsEthereumAddress,
  IsNotEmpty,
  IsNumber,
  IsUUID,
  Min,
} from 'class-validator';

import { SettlementMode } from './create-investment.dto';

export class CreateInvestmentIntentDto {
  @IsUUID()
  @IsNotEmpty()
  assetId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;

  @IsEnum(SettlementMode)
  settlementMode!: SettlementMode;

  /**
   * Wallet currently selected by Privy.
   *
   * Backend does NOT trust this address.
   * It compares it with the authenticated user's
   * walletAddress stored in PostgreSQL.
   */
  @IsEthereumAddress()
  @IsNotEmpty()
  walletAddress!: string;
}
