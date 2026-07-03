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
  private marketplaceContract: ethers.Contract;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL')!;
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY')!;
    const registryAddr = this.configService.get<string>(
      'COMPLIANCE_CONTRACT_ADDRESS',
    )!;
    const factoryAddr = this.configService.get<string>(
      'ASSET_FACTORY_CONTRACT_ADDRESS',
    )!;
    const marketplaceAddr = this.configService.get<string>(
      'MARKETPLACE_CONTRACT_ADDRESS',
    )!;

    const network = { name: 'local-hardhat', chainId: 31337 };

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

    // Initialize Marketplace Interface
    const marketplaceAbi = [
      'function createListing(string calldata listingId, address token, uint256 amount) external',
      'function settleTrade(string calldata listingId, address seller, address buyer) external',
      'function listings(string) view returns (address seller, address token, uint256 amount, bool active)',
      'function cancelListing(string calldata listingId) external',
    ];
    this.marketplaceContract = new ethers.Contract(
      marketplaceAddr,
      marketplaceAbi,
      this.wallet,
    );
  }

  async onModuleInit() {
    this.logger.log(`Blockchain Service initialized.`);
    this.logger.log(`Registry: ${this.registryContract.target}`);
    this.logger.log(`Factory: ${this.factoryContract.target}`);
  }

  // --- IDENTITY & ASSET MANAGEMENT ---
  public getIndexerProvider() {
    return new ethers.JsonRpcProvider(
      this.configService.get<string>('BLOCKCHAIN_RPC_URL')!,
    );
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
    const tx = await this.factoryContract.deployAsset(
      name,
      symbol,
      supply,
      metadataHash,
      treasuryAddress,
    );
    const receipt = await tx.wait(1);
    if (receipt?.status === 0) throw new Error('Deployment reverted.');
    const event = receipt?.logs.find(
      (log: any) =>
        this.factoryContract.interface.parseLog(log)?.name ===
        'AssetTokenDeployed',
    );
    return this.factoryContract.interface.parseLog(event)!.args.tokenAddress;
  }

  async registerIdentity(
    investorWallet: string,
    status: boolean,
  ): Promise<string> {
    return (
      await (
        await this.registryContract.registerIdentity(investorWallet, status)
      ).wait(1)
    ).hash;
  }

  async toggleFreeze(
    investorWallet: string,
    shouldFreeze: boolean,
  ): Promise<string> {
    return (
      await (
        await this.registryContract.toggleFreeze(investorWallet, shouldFreeze)
      ).wait(1)
    ).hash;
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
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function transfer(address, uint256) returns (bool)'],
      this.wallet,
    );
    const tx = await tokenContract.transfer(
      to,
      ethers.parseUnits(amount.toString(), decimals),
    );
    return (await tx.wait(1)).hash;
  }

  async verifyApproval(
    tokenAddress: string,
    sellerWallet: string,
    spenderAddress: string,
    requiredAmount: number,
    decimals: number = 18,
  ): Promise<boolean> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function allowance(address, address) view returns (uint256)'],
      this.provider,
    );
    const allowance = await tokenContract.allowance(
      sellerWallet,
      spenderAddress,
    );
    return (
      BigInt(allowance) >=
      ethers.parseUnits(requiredAmount.toString(), decimals)
    );
  }

  // --- MARKETPLACE LOGIC ---
  async settleTrade(
    listingId: string,
    sellerAddress: string,
    buyerAddress: string,
  ): Promise<string> {
    const tx = await this.marketplaceContract.settleTrade(
      listingId,
      sellerAddress,
      buyerAddress,
    );
    return (await tx.wait(1)).hash;
  }

  async createListingOnChain(
    listingId: string,
    tokenAddress: string,
    amount: bigint,
  ) {
    try {
      const tx = await this.marketplaceContract.createListing(
        listingId,
        tokenAddress,
        amount,
      );
      await tx.wait(1);
    } catch (err: any) {
      if (!(await this.isListingActive(listingId))) throw err;
    }
  }

  async isListingActive(listingId: string): Promise<boolean> {
    const listing = await this.marketplaceContract.listings(listingId);
    return listing.active === true;
  }

  async executeAtomicSwap(
    seller: string,
    buyer: string,
    tokenAddress: string,
    amount: number,
    price: number,
  ): Promise<string> {
    // Legacy support for your existing workflow
    const tx = await this.marketplaceContract.executeTrade(
      seller,
      buyer,
      tokenAddress,
      ethers.parseUnits(amount.toString(), 18),
      ethers.parseUnits(price.toString(), 18),
    );
    return (await tx.wait(1)).hash;
  }
}
