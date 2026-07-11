import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as RemzikIdentityRegistryABI from './abi/RemzikIdentityRegistry.json';
import * as AssetFactoryABI from './abi/AssetFactory.json';
import * as YieldNotaryABI from './abi/YieldNotary.json';
import { Mutex } from 'async-mutex';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private registryContract: ethers.Contract;
  private factoryContract: ethers.Contract;
  private marketplaceContract: ethers.Contract;
  private yieldNotaryContract: ethers.Contract;
  private readonly transactionMutex = new Mutex();

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL')!;
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY')!;

    const network = { name: 'local-hardhat', chainId: 31337 };
    this.provider = new ethers.JsonRpcProvider(rpcUrl, network, {
      staticNetwork: true,
    });

    this.wallet = new ethers.Wallet(privateKey, this.provider);

    this.registryContract = new ethers.Contract(
      this.configService.get('COMPLIANCE_CONTRACT_ADDRESS')!,
      (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI,
      this.wallet,
    );

    this.factoryContract = new ethers.Contract(
      this.configService.get('ASSET_FACTORY_CONTRACT_ADDRESS')!,
      (AssetFactoryABI as any).abi || AssetFactoryABI,
      this.wallet,
    );

    const marketplaceAbi = [
      'function createListing(string calldata listingId, address token, uint256 amount) external',
      'function settleTrade(string calldata listingId, address seller, address buyer, uint256 tradePrice) external',
      'function listings(string) view returns (address seller, address token, uint256 amount, bool active)',
      'function cancelListing(string calldata listingId) external',
    ];
    this.marketplaceContract = new ethers.Contract(
      this.configService.get('MARKETPLACE_CONTRACT_ADDRESS')!,
      marketplaceAbi,
      this.wallet,
    );

    this.yieldNotaryContract = new ethers.Contract(
      this.configService.get('YIELD_NOTARY_ADDRESS')!,
      (YieldNotaryABI as any).abi || YieldNotaryABI,
      this.wallet,
    );
  }

  async onModuleInit() {
    this.logger.log('Blockchain Service initialized.');
  }

  // --- MANUAL NONCE EXECUTION WRAPPER ---
  private async executeTx(
    contractMethod: (
      nonce: number,
    ) => Promise<ethers.ContractTransactionResponse>,
  ) {
    return await this.transactionMutex.runExclusive(async () => {
      const address = await this.wallet.getAddress();
      // UPDATED: Using 'pending' to account for transactions currently in the mempool
      const nonce = await this.provider.getTransactionCount(address, 'pending');

      const tx = await contractMethod(nonce);
      await tx.wait();
      this.logger.log(`Transaction mined: ${tx.hash} (Nonce: ${nonce})`);
      return tx;
    });
  }

  // --- CONTRACT METHODS ---

  /**
   * @notice Settles a trade on-chain for a given listing.
   * @param listingId The unique identifier of the listing.
   * @param sellerAddress The wallet address of the seller.
   * @param buyerAddress The wallet address of the buyer.
   * @param priceWei The total execution price in Wei (18-decimal scale).
   */
  async settleTrade(
    listingId: string,
    sellerAddress: string,
    buyerAddress: string,
    priceWei: string,
  ) {
    // This call is wrapped in executeTx, which uses:
    // 1. Mutex (transactionMutex) to serialize requests.
    // 2. 'pending' nonce count to account for mempool transactions.
    // 3. await tx.wait() to force the node to process the nonce increment.
    return await this.executeTx((nonce) =>
      this.marketplaceContract.settleTrade(
        listingId,
        sellerAddress,
        buyerAddress,
        BigInt(priceWei),
        {
          nonce,
          // Explicit gas settings are not required if your provider estimates them,
          // but if you experience sporadic timeouts, you can add:
          // gasLimit: 500000,
        },
      ),
    );
  }

  async deployAssetContract(
    name: string,
    symbol: string,
    supply: string,
    metadataHash: string,
    treasuryAddress: string,
  ): Promise<string> {
    const tx = await this.executeTx((nonce) =>
      this.factoryContract.deployAsset(
        name,
        symbol,
        BigInt(supply),
        metadataHash,
        treasuryAddress,
        { nonce },
      ),
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) throw new Error('Deployment failed.');

    for (const log of receipt.logs) {
      try {
        const parsedLog = this.factoryContract.interface.parseLog(log as any);
        if (parsedLog?.name === 'AssetTokenDeployed')
          return parsedLog.args.tokenAddress;
      } catch (e) {}
    }
    throw new Error('AssetTokenDeployed event not found.');
  }

  async createListingOnChain(
    listingId: string,
    tokenAddress: string,
    amount: string,
  ) {
    return await this.executeTx((nonce) =>
      this.marketplaceContract.createListing(
        listingId,
        tokenAddress,
        BigInt(amount),
        { nonce },
      ),
    );
  }

  async updatePriceBandOnChain(tokenAddress: string, min: string, max: string) {
    const oracleContract = new ethers.Contract(
      this.configService.get('PRICE_ORACLE_CONTRACT_ADDRESS')!,
      [
        'function setPriceBand(address token, uint256 lowerBound, uint256 upperBound) external',
      ],
      this.wallet,
    );
    return await this.executeTx((nonce) =>
      oracleContract.setPriceBand(tokenAddress, BigInt(min), BigInt(max), {
        nonce,
      }),
    );
  }

  async registerIdentity(investorWallet: string, status: boolean) {
    return await this.executeTx((nonce) =>
      this.registryContract.registerIdentity(investorWallet, status, { nonce }),
    );
  }

  async toggleFreeze(investorWallet: string, shouldFreeze: boolean) {
    return await this.executeTx((nonce) =>
      this.registryContract.toggleFreeze(investorWallet, shouldFreeze, {
        nonce,
      }),
    );
  }

  async transferFromVault(
    tokenAddress: string,
    to: string,
    amount: string,
    decimals = 18,
  ) {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function transfer(address, uint256) returns (bool)'],
      this.wallet,
    );
    return await this.executeTx((nonce) =>
      tokenContract.transfer(to, ethers.parseUnits(amount, decimals), {
        nonce,
      }),
    );
  }

  async recordYieldOnChain(
    batchId: string,
    propertyAddress: string,
    totalNetYield: string,
  ) {
    return await this.executeTx((nonce) =>
      this.yieldNotaryContract.recordYield(
        ethers.encodeBytes32String(batchId),
        propertyAddress,
        ethers.parseUnits(totalNetYield, 18),
        { nonce },
      ),
    );
  }

  // --- HELPERS ---

  getIndexerProvider = () => this.provider;
  getProvider = () => this.provider;
  public getRegistryAddress = () => this.registryContract.target as string;
  public getFactoryAddress = () => this.factoryContract.target as string;
  public getRegistryAbi = () =>
    (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI;
  public getFactoryAbi = () => (AssetFactoryABI as any).abi || AssetFactoryABI;

  async isVerified(investorWallet: string): Promise<boolean> {
    return await this.registryContract.isClearToTrade(investorWallet);
  }

  async isListingActive(listingId: string): Promise<boolean> {
    return (await this.marketplaceContract.listings(listingId)).active === true;
  }

  async verifyApproval(
    tokenAddress: string,
    sellerWallet: string,
    spenderAddress: string,
    requiredAmount: string,
    decimals = 18,
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
    return BigInt(allowance) >= ethers.parseUnits(requiredAmount, decimals);
  }

  async getAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
  ): Promise<bigint> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function allowance(address, address) view returns (uint256)'],
      this.provider,
    );
    return await tokenContract.allowance(owner, spender);
  }

  getMarketplaceAddress(): string {
    return this.configService.get('MARKETPLACE_CONTRACT_ADDRESS')!;
  }
}
