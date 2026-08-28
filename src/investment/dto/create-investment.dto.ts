import {
  IsNotEmpty,
  IsNumber,
  IsUUID,
  Min,
  IsEnum,
  IsString,
  IsOptional,
} from 'class-validator';

export enum SettlementMode {
  OFF_CHAIN = 'OFF_CHAIN',
  ON_CHAIN = 'ON_CHAIN',
}

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

  /**
   * ✅ PHASE 3: Optional settlement mode selector
   * Defaults to OFF_CHAIN for existing internal balance flows
   */
  @IsOptional()
  @IsEnum(SettlementMode)
  settlementMode?: SettlementMode = SettlementMode.OFF_CHAIN;

  /**
   * ✅ PHASE 3: On-chain transaction hash from TreasuryVault.deposit()
   * Required if settlementMode is ON_CHAIN
   */
  @IsOptional()
  @IsString()
  txHash?: string;
}
