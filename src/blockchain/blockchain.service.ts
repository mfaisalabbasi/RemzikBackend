import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as RemzikIdentityRegistryABI from './abi/RemzikIdentityRegistry.json';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;

  constructor(private configService: ConfigService) {
    const rpcUrl =
      this.configService.get<string>('BLOCKCHAIN_RPC_URL') ||
      'http://127.0.0.1:8545';

    // 1. Fetch and robustly typecast/validate secrets to satisfy TS strict mode
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY');
    const contractAddress = this.configService.get<string>(
      'COMPLIANCE_CONTRACT_ADDRESS',
    );

    if (!privateKey || !contractAddress) {
      throw new Error(
        'CRITICAL: ADMIN_PRIVATE_KEY or COMPLIANCE_CONTRACT_ADDRESS is missing in environment config',
      );
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    this.contract = new ethers.Contract(
      contractAddress,
      RemzikIdentityRegistryABI.abi,
      this.wallet,
    );
  }

  /**
   * Updates verification/KYC status on-chain.
   */
  async registerIdentity(
    investorWallet: string,
    status: boolean,
  ): Promise<string> {
    try {
      this.logger.log(
        `Registering identity on-chain for ${investorWallet} status: ${status}`,
      );
      const tx = await this.contract.registerIdentity(investorWallet, status);
      const receipt = await tx.wait(1);
      return tx.hash;
    } catch (error: any) {
      this.logger.error(
        `Failed on-chain registration for ${investorWallet}:`,
        error.message,
      );
      throw new InternalServerErrorException(
        `Blockchain transaction failed: ${error.message}`,
      );
    }
  }

  /**
   * Emergency switch to freeze or unfreeze a wallet on-chain.
   */
  async toggleFreeze(
    investorWallet: string,
    shouldFreeze: boolean,
  ): Promise<string> {
    try {
      this.logger.log(
        `Toggling on-chain freeze state for ${investorWallet} to: ${shouldFreeze}`,
      );
      const tx = await this.contract.toggleFreeze(investorWallet, shouldFreeze);
      const receipt = await tx.wait(1);
      return tx.hash;
    } catch (error: any) {
      this.logger.error(
        `Failed executing freeze on-chain for ${investorWallet}:`,
        error.message,
      );
      throw new InternalServerErrorException(
        `Blockchain freeze transaction failed: ${error.message}`,
      );
    }
  }

  /**
   * Read view function to see if user is verified on-chain.
   * Fixed return type to native TypeScript 'boolean'.
   */
  async isVerified(investorWallet: string): Promise<boolean> {
    try {
      // Calls your smart contract's isClearToTrade or mapping layout getter
      return await this.contract.isClearToTrade(investorWallet);
    } catch (error: any) {
      this.logger.error(
        `Failed to read verification status for wallet ${investorWallet}:`,
        error.message,
      );
      return false;
    }
  }
}
