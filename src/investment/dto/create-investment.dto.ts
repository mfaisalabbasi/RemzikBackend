import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export enum SettlementMode {
  OFF_CHAIN = 'OFF_CHAIN',
  ON_CHAIN = 'ON_CHAIN',
}

export class CreateInvestmentDto {
  @IsUUID()
  @IsNotEmpty()
  assetId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;

  /**
   * Required only for OFF_CHAIN settlement.
   *
   * This is an application-level idempotency/reference ID.
   * It is NOT a blockchain transaction hash.
   */
  @IsUUID()
  @IsNotEmpty()
  transactionId!: string;

  @IsOptional()
  @IsEnum(SettlementMode)
  settlementMode?: SettlementMode = SettlementMode.OFF_CHAIN;
}
