import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as RemzikIdentityRegistryABI from './abi/RemzikIdentityRegistry.json';
import * as AssetFactoryABI from './abi/AssetFactory.json';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private wallet: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;
  private registryContract: ethers.Contract;
  private factoryContract: ethers.Contract;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL')!;
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY')!;
    const registryAddr = this.configService.get<string>(
      'COMPLIANCE_CONTRACT_ADDRESS',
    )!;
    const factoryAddr = this.configService.get<string>(
      'ASSET_FACTORY_CONTRACT_ADDRESS',
    )!;

    console.log('DEBUG: Registry being used:', registryAddr);
    console.log('DEBUG: Factory being used:', factoryAddr);

    this.provider = new ethers.JsonRpcProvider(rpcUrl, {
      name: 'local-hardhat',
      chainId: 31337,
    });

    this.wallet = new ethers.Wallet(privateKey, this.provider);

    // Initialize contracts using ABI and Signer
    this.registryContract = new ethers.Contract(
      registryAddr,
      (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI,
      this.wallet,
    );
    this.factoryContract = new ethers.Contract(
      factoryAddr,
      (AssetFactoryABI as any).abi || AssetFactoryABI,
      this.wallet,
    );
  }

  async onModuleInit() {
    this.logger.log(`Blockchain Service initialized.`);
    this.logger.log(`Registry: ${this.registryContract.target}`);
    this.logger.log(`Factory: ${this.factoryContract.target}`);
  }

  public getProvider() {
    return this.provider;
  }
  public getRegistryAddress() {
    return this.registryContract.target as string;
  }
  public getFactoryAddress() {
    return this.factoryContract.target as string;
  }
  public getRegistryAbi() {
    return (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI;
  }
  public getFactoryAbi() {
    return (AssetFactoryABI as any).abi || AssetFactoryABI;
  }

  async deployAssetContract(
    name: string,
    symbol: string,
    supply: bigint,
    metadataHash: string,
    treasuryAddress: string,
  ): Promise<string> {
    try {
      this.logger.log(`Deploying token: ${name} (${symbol}) via Factory...`);

      const tx = await this.factoryContract.deployAsset(
        name,
        symbol,
        supply,
        metadataHash,
        treasuryAddress,
      );

      const receipt = await tx.wait(1);
      if (receipt?.status === 0) throw new Error('Deployment reverted by EVM.');

      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = this.factoryContract.interface.parseLog(log);
          return parsed?.name === 'AssetTokenDeployed';
        } catch {
          return false;
        }
      });

      if (!event) throw new Error('AssetTokenDeployed event not found.');

      return this.factoryContract.interface.parseLog(event)!.args.tokenAddress;
    } catch (error: any) {
      this.logger.error(`Deployment failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  async registerIdentity(
    investorWallet: string,
    status: boolean,
  ): Promise<string> {
    const tx = await this.registryContract.registerIdentity(
      investorWallet,
      status,
    );
    return (await tx.wait(1))!.hash;
  }

  async toggleFreeze(
    investorWallet: string,
    shouldFreeze: boolean,
  ): Promise<string> {
    const tx = await this.registryContract.toggleFreeze(
      investorWallet,
      shouldFreeze,
    );
    return (await tx.wait(1))!.hash;
  }

  async isVerified(investorWallet: string): Promise<boolean> {
    return await this.registryContract.isClearToTrade(investorWallet);
  }

  async transferFromVault(
    tokenAddress: string,
    to: string,
    amount: number,
    decimals: number = 18,
  ): Promise<string> {
    const erc20Abi = [
      'function transfer(address to, uint256 amount) external returns (bool)',
    ];
    const tokenContract = new ethers.Contract(
      tokenAddress,
      erc20Abi,
      this.wallet,
    );
    const amountBigInt = ethers.parseUnits(amount.toString(), decimals);
    const tx = await tokenContract.transfer(to, amountBigInt);
    const receipt = await tx.wait(1);
    if (receipt?.status === 0) throw new Error('Transfer reverted.');
    return receipt!.hash;
  }
}
