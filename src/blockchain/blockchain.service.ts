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

    const network = {
      name: 'local-hardhat',
      chainId: 31337,
    };

    // Main provider for API/Transaction operations
    this.provider = new ethers.JsonRpcProvider(rpcUrl, network, {
      staticNetwork: true,
    });

    this.wallet = new ethers.Wallet(privateKey, this.provider);

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

  // CRITICAL: Isolated provider for the Indexer to prevent blocking the API
  public getIndexerProvider() {
    const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL')!;
    return new ethers.JsonRpcProvider(rpcUrl);
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
          return (
            this.factoryContract.interface.parseLog(log)?.name ===
            'AssetTokenDeployed'
          );
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
    const tx = await tokenContract.transfer(
      to,
      ethers.parseUnits(amount.toString(), decimals),
    );
    const receipt = await tx.wait(1);
    if (receipt?.status === 0) throw new Error('Transfer reverted.');
    return receipt!.hash;
  }

  async verifyApproval(
    tokenAddress: string,
    sellerWallet: string,
    spenderAddress: string,
    requiredAmount: number,
    decimals: number = 18,
  ): Promise<boolean> {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function allowance(address, address) view returns (uint256)'],
        this.provider,
      );

      // Timeout is MANDATORY to prevent API hangs
      const allowance = await Promise.race([
        tokenContract.allowance(sellerWallet, spenderAddress),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('RPC_TIMEOUT')), 40000),
        ),
      ]);

      const requiredBigInt = ethers.parseUnits(
        requiredAmount.toString(),
        decimals,
      );
      return BigInt(allowance as any) >= requiredBigInt;
    } catch (error: any) {
      this.logger.error(`Allowance check failed: ${error.message}`);
      return false;
    }
  }

  async executeAtomicSwap(
    seller: string,
    buyer: string,
    tokenAddress: string,
    amount: number,
    price: number,
  ): Promise<string> {
    const marketplaceAbi = [
      'function executeTrade(address seller, address buyer, address token, uint256 amount, uint256 price) external returns (bytes32)',
    ];
    const marketplaceContract = new ethers.Contract(
      process.env.MARKETPLACE_CONTRACT_ADDRESS!,
      marketplaceAbi,
      this.wallet,
    );
    const tx = await marketplaceContract.executeTrade(
      seller,
      buyer,
      tokenAddress,
      ethers.parseUnits(amount.toString(), 18),
      ethers.parseUnits(price.toString(), 18),
    );
    const receipt = await tx.wait(1);
    return receipt.hash;
  }
  // Add these to your BlockchainService class
  // ... (inside BlockchainService)
  async createListingOnChain(
    listingId: string,
    tokenAddress: string, // Removed sellerAddress
    amount: bigint,
  ) {
    const marketplaceContract = new ethers.Contract(
      this.configService.get<string>('MARKETPLACE_CONTRACT_ADDRESS')!,
      [
        // Updated interface: No 'address seller' parameter
        'function createListing(string calldata listingId, address token, uint256 amount) external',
      ],
      this.wallet,
    );

    try {
      // Updated function call: Only 3 arguments
      const tx = await marketplaceContract.createListing(
        listingId,
        tokenAddress,
        amount,
      );
      await tx.wait(1);
      this.logger.log(`Listing ${listingId} confirmed on-chain.`);
    } catch (err: any) {
      // ANTI-FRAGILE LOGIC:
      // Check if the listing actually exists on-chain despite the transaction error
      const isActive = await this.isListingActive(listingId);

      if (isActive) {
        this.logger.warn(
          `Blockchain reported error for ${listingId}, but listing is already ACTIVE. Proceeding as success.`,
        );
        return; // Force a success path
      }

      // If it truly doesn't exist, THEN throw
      this.logger.error(
        `Real blockchain failure for ${listingId}: ${err.message}`,
      );
      throw err;
    }
  }

  async isListingActive(listingId: string): Promise<boolean> {
    const marketplaceContract = new ethers.Contract(
      this.configService.get<string>('MARKETPLACE_CONTRACT_ADDRESS')!,
      [
        'function listings(string) view returns (bool active, uint256 amount, address seller)',
      ],
      this.provider, // Use the provider, NOT the admin wallet
    );

    try {
      const listing = await marketplaceContract.listings(listingId);
      return listing.active === true;
    } catch (error: any) {
      this.logger.error(
        `Failed to verify listing ${listingId}: ${error.message}`,
      );
      return false;
    }
  }
}
