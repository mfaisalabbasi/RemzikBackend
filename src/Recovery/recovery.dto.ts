// src/recovery/dto/recovery.dto.ts
import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class CreateRecoveryRequestDto {
  @IsString()
  @IsNotEmpty()
  oldWallet!: string;
  @IsString()
  @IsNotEmpty()
  newWallet!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsArray()
  @IsOptional()
  documentUrls?: string[];
}
