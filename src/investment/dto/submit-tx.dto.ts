import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SubmitTxDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'txHash must be a valid 32-byte transaction hash.',
  })
  txHash!: string;
}
