import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SyncWalletDto {
  @IsNotEmpty()
  @IsString()
  // Validates standard Ethereum hex address format (0x followed by 40 hex characters)
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'Invalid cryptographic wallet address format',
  })
  walletAddress!: string;
}
