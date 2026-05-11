// src/asset/dto/create-income.dto.ts
import { IsNumber, IsString, IsUUID, IsOptional, Min } from 'class-validator';

export class CreateIncomeDto {
  @IsUUID()
  assetId: string;

  @IsNumber()
  @Min(0)
  grossAmount: number;

  @IsNumber()
  @Min(0)
  expenses: number;

  @IsString()
  period: string; // e.g., "May 2026"

  @IsOptional()
  @IsString()
  documentUrl?: string; // Link to the PDF/Receipt proof
}
