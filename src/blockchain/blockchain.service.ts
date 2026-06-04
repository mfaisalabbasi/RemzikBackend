import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as RemzikIdentityRegistryABI from './abi/RemzikIdentityRegistry.json';
import * as AssetFactoryABI from './abi/AssetFactory.json';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private wallet: ethers.Wallet;

  private registryContract: ethers.Contract;
  private factoryContract: ethers.Contract;

  constructor(private configService: ConfigService) {
    const rpcUrl =
      this.configService.get<string>('BLOCKCHAIN_RPC_URL') ||
      'http://127.0.0.1:8545';
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY');
    const registryAddr = this.configService.get<string>(
      'COMPLIANCE_CONTRACT_ADDRESS',
    );
    const factoryAddr = this.configService.get<string>(
      'ASSET_FACTORY_CONTRACT_ADDRESS',
    );

    if (!privateKey || !registryAddr || !factoryAddr) {
      throw new Error('CRITICAL: Missing Blockchain environment variables');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, provider);

    this.registryContract = new ethers.Contract(
      registryAddr,
      RemzikIdentityRegistryABI.abi,
      this.wallet,
    );
    this.factoryContract = new ethers.Contract(
      factoryAddr,
      AssetFactoryABI.abi,
      this.wallet,
    );
  }

  // --- Identity Registry Methods ---

  async registerIdentity(
    investorWallet: string,
    status: boolean,
  ): Promise<string> {
    const tx = await this.registryContract.registerIdentity(
      investorWallet,
      status,
    );
    await tx.wait(1);
    return tx.hash;
  }

  async toggleFreeze(
    investorWallet: string,
    shouldFreeze: boolean,
  ): Promise<string> {
    const tx = await this.registryContract.toggleFreeze(
      investorWallet,
      shouldFreeze,
    );
    await tx.wait(1);
    return tx.hash;
  }

  async isVerified(investorWallet: string): Promise<boolean> {
    return await this.registryContract.isClearToTrade(investorWallet);
  }

  // --- Asset Factory Methods ---

  async deployAssetContract(
    name: string,
    symbol: string,
    supply: bigint,
    metadataHash: string,
    treasuryAddress: string,
  ): Promise<string> {
    try {
      this.logger.log(`Deploying token contract: ${name} (${symbol})`);

      const tx = await this.factoryContract.deployAsset(
        name,
        symbol,
        supply,
        metadataHash,
        treasuryAddress,
      );

      const receipt = await tx.wait(1);

      // Dynamically attempt to parse all logs in the receipt to find our event
      const parsedEvent = receipt.logs.reduce((found, log) => {
        if (found) return found;
        try {
          const parsed = this.factoryContract.interface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });
          return parsed?.name === 'AssetTokenDeployed' ? parsed : null;
        } catch {
          return null;
        }
      }, null);

      if (!parsedEvent) {
        this.logger.error('Full Receipt Logs:', JSON.stringify(receipt.logs));
        throw new Error(
          'AssetTokenDeployed event not found in transaction receipt',
        );
      }

      const tokenAddress = parsedEvent.args.tokenAddress;
      this.logger.log(`Contract successfully deployed at: ${tokenAddress}`);
      return tokenAddress;
    } catch (error: any) {
      this.logger.error(`Deployment failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }
}
