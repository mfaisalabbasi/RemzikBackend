import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers, Wallet, NonceManager } from 'ethers';
import { PrivyClient } from '@privy-io/node'; // 👈 Official Privy Node SDK
import * as RemzikIdentityRegistryABI from './abi/RemzikIdentityRegistry.json';
import * as AssetFactoryABI from './abi/AssetFactory.json';
import * as YieldNotaryABI from './abi/YieldNotary.json';
import * as RemzikAssetTokenABI from './abi/RemzikAssetToken.json';
import * as PropertyGovernanceABI from './abi/PropertyGovernance.json';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.JsonRpcProvider;
  private adminWallet: Wallet;
  private managedSigner: NonceManager;
  private registryContract: ethers.Contract;
  private factoryContract: ethers.Contract;
  private marketplaceContract: ethers.Contract;
  private yieldNotaryContract: ethers.Contract;
  private privy: PrivyClient; // 👈 Privy Client Instance

  constructor(private configService: ConfigService) {
    const rpcUrl =
      this.configService.get<string>('BLOCKCHAIN_RPC_URL') ||
      this.configService.get<string>('RPC_URL')!;
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY')!;

    const network = { name: 'local-hardhat', chainId: 31337 };
    this.provider = new ethers.JsonRpcProvider(rpcUrl, network, {
      staticNetwork: true,
    });

    this.adminWallet = new ethers.Wallet(privateKey, this.provider);
    this.managedSigner = new NonceManager(this.adminWallet);

    // 🛡️ Initialize Privy using Node SDK credentials from environment variables
    this.privy = new PrivyClient({
      appId: this.configService.get<string>('PRIVY_APP_ID') || '',
      appSecret: this.configService.get<string>('PRIVY_APP_SECRET') || '',
    });

    this.registryContract = new ethers.Contract(
      this.configService.get('COMPLIANCE_CONTRACT_ADDRESS')!,
      (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI,
      this.managedSigner,
    );

    this.factoryContract = new ethers.Contract(
      this.configService.get('ASSET_FACTORY_CONTRACT_ADDRESS')!,
      (AssetFactoryABI as any).abi || AssetFactoryABI,
      this.managedSigner,
    );

    const marketplaceAbi = [
      'function createListing(string calldata listingId, address token, uint256 amount) external',
      'function settleTrade(string calldata listingId, address seller, address buyer, uint256 tradePrice) external',
      'function listings(string) view returns (address seller, address token, uint256 amount, bool active)',
      'function getListing(string calldata listingId) view returns (address seller, address token, uint256 amount, bool active)',
      'function cancelListing(string calldata listingId) external',
    ];
    this.marketplaceContract = new ethers.Contract(
      this.configService.get('MARKETPLACE_CONTRACT_ADDRESS')!,
      marketplaceAbi,
      this.managedSigner,
    );

    this.yieldNotaryContract = new ethers.Contract(
      this.configService.get('YIELD_NOTARY_ADDRESS')!,
      (YieldNotaryABI as any).abi || YieldNotaryABI,
      this.managedSigner,
    );
  }

  async onModuleInit() {
    this.logger.log(
      'Blockchain Service initialized cleanly using native ethers NonceManager and Privy Node SDK.',
    );
  }

  // --- PHASE 10: RECOVERY HELPER METHODS VIA PRIVY ---

  async generateEmbeddedWalletForUser(privyUserId: string): Promise<string> {
    try {
      this.logger.log(
        `🔑 Provisioning secure Privy Embedded Recovery Wallet for Privy user ID: ${privyUserId}`,
      );

      const wallet = await this.privy.wallets().create({
        chain_type: 'ethereum',
        owner: {
          user_id: privyUserId,
        },
      });

      if (!wallet || !wallet.address) {
        throw new Error(
          'Privy failed to return a valid wallet address during recovery provisioning.',
        );
      }

      this.logger.log(
        `✅ Successfully generated Privy Recovery Wallet: ${wallet.address}`,
      );
      return wallet.address;
    } catch (error: any) {
      this.logger.error(
        `⚠️ Privy wallet provisioning failed: ${error.message}`,
      );
      throw error;
    }
  }

  async executeWalletRecovery(
    tokenAddress: string,
    oldWallet: string,
    newWallet: string,
    amount: string,
  ): Promise<string> {
    const recoveryManagerAddress = this.configService.get<string>(
      'RECOVERY_MANAGER_CONTRACT_ADDRESS',
    );
    if (!recoveryManagerAddress) {
      throw new Error(
        'RECOVERY_MANAGER_CONTRACT_ADDRESS is missing in environment variables',
      );
    }

    const recoveryManagerAbi = [
      'function recoverWallet(address tokenAddress, address oldWallet, address newWallet, uint256 amount) external',
    ];

    const recoveryContract = new ethers.Contract(
      recoveryManagerAddress,
      recoveryManagerAbi,
      this.managedSigner,
    );

    this.logger.log(
      `🔄 Executing on-chain recovery from ${oldWallet} to ${newWallet} for token ${tokenAddress}...`,
    );

    const tx = await recoveryContract.recoverWallet(
      tokenAddress,
      oldWallet,
      newWallet,
      BigInt(amount),
    );

    const receipt = await tx.wait();
    this.logger.log(
      `✅ Wallet recovery successfully mined on-chain! TxHash: ${receipt.hash}`,
    );
    return receipt.hash;
  }

  async settleTrade(
    listingId: string,
    sellerAddress: string,
    buyerAddress: string,
    priceWei: string,
  ) {
    const tx = await this.marketplaceContract.settleTrade(
      listingId,
      sellerAddress,
      buyerAddress,
      BigInt(priceWei),
    );
    await tx.wait();
    this.logger.log(`Transaction mined: ${tx.hash}`);
    return tx;
  }

  async ensureFactoryLinked() {
    const tokenDeployer = await this.factoryContract.tokenDeployer();
    const govDeployer = await this.factoryContract.govDeployer();

    const envTokenDeployer = this.configService.get<string>(
      'TOKEN_DEPLOYER_ADDRESS',
    );
    const envGovDeployer = this.configService.get<string>(
      'GOV_DEPLOYER_ADDRESS',
    );

    if (!envTokenDeployer || !envGovDeployer) {
      throw new Error(
        'TOKEN_DEPLOYER_ADDRESS or GOV_DEPLOYER_ADDRESS is missing in .env',
      );
    }

    if (
      tokenDeployer === ethers.ZeroAddress ||
      govDeployer === ethers.ZeroAddress ||
      tokenDeployer.toLowerCase() !== envTokenDeployer.toLowerCase() ||
      govDeployer.toLowerCase() !== envGovDeployer.toLowerCase()
    ) {
      this.logger.warn(`⚠️ Linking deployers to AssetFactory on-chain...`);
      const tx = await this.factoryContract.setDeployers(
        envTokenDeployer,
        envGovDeployer,
      );
      await tx.wait();
      this.logger.log(
        `✅ AssetFactory successfully linked to deployers! Hash: ${tx.hash}`,
      );
      return tx;
    }
  }

  async deployAssetContract(
    name: string,
    symbol: string,
    supply: string,
    metadataHash: string,
    registryAddress: string,
    propertyId: string,
  ): Promise<{
    tokenAddress: string;
    treasuryAddress: string;
    governanceAddress: string;
  }> {
    await this.ensureFactoryLinked();

    const adminWalletAddress = await this.adminWallet.getAddress();
    const factoryAddress = await this.factoryContract.getAddress();

    const tokenBytecode = (RemzikAssetTokenABI as any).bytecode;
    const govBytecode = (PropertyGovernanceABI as any).bytecode;

    const formattedPropertyId =
      typeof propertyId === 'string' &&
      propertyId.startsWith('0x') &&
      propertyId.length === 66
        ? propertyId
        : ethers.id(propertyId);

    const govArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'address'],
      [
        factoryAddress,
        adminWalletAddress,
        ethers.ZeroAddress,
        adminWalletAddress,
      ],
    );

    const tokenArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'string',
        'string',
        'uint256',
        'string',
        'address',
        'address',
        'address',
      ],
      [
        name,
        symbol,
        BigInt(supply),
        metadataHash,
        registryAddress,
        adminWalletAddress,
        factoryAddress,
      ],
    );

    const tx = await this.factoryContract.deployAssetWithBytecode(
      tokenBytecode,
      tokenArgs,
      govBytecode,
      govArgs,
      name,
      formattedPropertyId,
      adminWalletAddress,
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) throw new Error('Deployment failed.');

    let deployedTokenAddress = '';
    let deployedTreasuryAddress = '';
    let deployedGovAddress = '';

    for (const log of receipt.logs) {
      try {
        const parsedLog = this.factoryContract.interface.parseLog(log as any);
        if (parsedLog?.name === 'AssetPodDeployed') {
          deployedTokenAddress = parsedLog.args.tokenAddress;
          deployedTreasuryAddress = parsedLog.args.treasuryAddress;
          deployedGovAddress = parsedLog.args.governanceAddress;
          break;
        }
      } catch (e) {}
    }

    if (
      !deployedGovAddress ||
      !deployedTokenAddress ||
      !deployedTreasuryAddress
    ) {
      throw new Error(
        'AssetPodDeployed event or deployed addresses not found.',
      );
    }

    const govContract = new ethers.Contract(
      deployedGovAddress,
      ['function setToken(address _token) external'],
      this.managedSigner,
    );

    const linkTx = await govContract.setToken(deployedTokenAddress);
    await linkTx.wait();

    this.logger.log(
      `✅ Asset Pod & Engine 2 Treasury successfully deployed! Token: ${deployedTokenAddress}, Treasury: ${deployedTreasuryAddress}, Gov: ${deployedGovAddress}`,
    );

    return {
      tokenAddress: deployedTokenAddress,
      treasuryAddress: deployedTreasuryAddress,
      governanceAddress: deployedGovAddress,
    };
  }

  async createListingOnChain(
    listingId: string,
    tokenAddress: string,
    amount: string,
  ) {
    const tx = await this.marketplaceContract.createListing(
      listingId,
      tokenAddress,
      BigInt(amount),
    );
    await tx.wait();
    return tx;
  }

  async updatePriceBandOnChain(tokenAddress: string, min: string, max: string) {
    const oracleContract = new ethers.Contract(
      this.configService.get('PRICE_ORACLE_CONTRACT_ADDRESS')!,
      [
        'function setPriceBand(address token, uint256 lowerBound, uint256 upperBound) external',
      ],
      this.managedSigner,
    );
    const tx = await oracleContract.setPriceBand(
      tokenAddress,
      BigInt(min),
      BigInt(max),
    );
    await tx.wait();
    return tx;
  }

  async registerIdentity(investorWallet: string, status: boolean) {
    const tx = await this.registryContract.registerIdentity(
      investorWallet,
      status,
    );
    await tx.wait();
    return tx;
  }

  async toggleFreeze(investorWallet: string, shouldFreeze: boolean) {
    const tx = await this.registryContract.toggleFreeze(
      investorWallet,
      shouldFreeze,
    );
    await tx.wait();
    return tx;
  }

  /**
   * Transfers token shares from the specific per-asset Treasury Vault contract
   * stored in the database to the investor's destination wallet address.
   */
  async transferFromTreasuryVault(
    tokenAddress: string,
    treasuryAddress: string,
    to: string,
    amountUnits: string,
    decimals = 18,
  ): Promise<any> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        'function balanceOf(address account) view returns (uint256)',
        'function paused() view returns (bool)',
      ],
      this.provider,
    );

    const isPaused = await tokenContract.paused().catch(() => false);
    if (isPaused) {
      throw new Error(
        'Investment failed: Asset token is paused due to emergency liquidation.',
      );
    }

    const parsedAmount = ethers.parseUnits(amountUnits, decimals);

    // Verify token balance of the specific asset's Treasury Vault contract
    const vaultBalance = await tokenContract.balanceOf(treasuryAddress);
    if (vaultBalance < parsedAmount) {
      this.logger.error(
        `Treasury Vault (${treasuryAddress}) balance insufficient. Required: ${parsedAmount.toString()}, Available: ${vaultBalance.toString()}`,
      );
      throw new Error(
        `Treasury Vault balance insufficient for asset token ${tokenAddress}`,
      );
    }

    // Interact with the Treasury Vault contract directly as the sender/controller
    const treasuryVaultAbi = [
      'function releaseTokens(address token, address to, uint256 amount) external',
      'function withdraw(address token, address to, uint256 amount) external',
      'function transferToken(address token, address to, uint256 amount) external',
    ];

    const treasuryVaultContract = new ethers.Contract(
      treasuryAddress,
      treasuryVaultAbi,
      this.managedSigner,
    );

    this.logger.log(
      `📦 Executing token release from Treasury Vault ${treasuryAddress} to ${to} for amount ${amountUnits}...`,
    );

    let tx;
    try {
      tx = await treasuryVaultContract.releaseTokens(
        tokenAddress,
        to,
        parsedAmount,
      );
    } catch (e: any) {
      try {
        tx = await treasuryVaultContract.withdraw(
          tokenAddress,
          to,
          parsedAmount,
        );
      } catch (e2: any) {
        tx = await treasuryVaultContract.transferToken(
          tokenAddress,
          to,
          parsedAmount,
        );
      }
    }

    const receipt = await tx.wait();
    this.logger.log(
      `✅ Vault transfer mined successfully from ${treasuryAddress}. Hash: ${receipt.hash}`,
    );
    return receipt;
  }

  /**
   * Backwards compatibility wrapper for code still passing 4 arguments.
   */
  async transferFromVault(
    tokenAddress: string,
    to: string,
    amount: string,
    decimals = 18,
  ) {
    throw new Error(
      'transferFromVault requires the treasuryAddress as the second parameter. Please use transferFromTreasuryVault(tokenAddress, treasuryAddress, to, amount, decimals).',
    );
  }

  async recordYieldOnChain(
    batchId: string,
    propertyAddress: string,
    totalNetYield: string,
  ) {
    const tx = await this.yieldNotaryContract.recordYield(
      ethers.encodeBytes32String(batchId),
      propertyAddress,
      ethers.parseUnits(totalNetYield, 18),
    );
    await tx.wait();
    return tx;
  }

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
    try {
      const listing = await this.marketplaceContract.getListing(listingId);

      const isActive = listing.active ?? listing[3];
      const seller = listing.seller ?? listing[0];

      return Boolean(isActive) && seller !== ethers.ZeroAddress;
    } catch (error: any) {
      this.logger.error(
        `Failed to verify listing on-chain for ${listingId}: ${error.message}`,
      );
      return false;
    }
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

  async triggerLiquidationOnChain(governanceAddress: string) {
    if (!governanceAddress || !ethers.isAddress(governanceAddress)) {
      throw new Error(`Invalid governance address: ${governanceAddress}`);
    }

    const governanceAbi = ['function emergencyLiquidate() external'];
    const govContract = new ethers.Contract(
      governanceAddress,
      governanceAbi,
      this.managedSigner,
    );

    try {
      const tx = await govContract.emergencyLiquidate({ gasLimit: 150000 });
      await tx.wait();
      return tx;
    } catch (error: any) {
      const errorString = JSON.stringify(error);
      if (
        error.message?.includes('EnforcedPause') ||
        error.message?.includes('0xd93c0665') ||
        error.data === '0xd93c0665' ||
        errorString.includes('0xd93c0665') ||
        errorString.includes('EnforcedPause')
      ) {
        this.logger.warn(
          `⚠️ Contract at ${governanceAddress} is already paused/liquidated on-chain.`,
        );
        return { hash: '0x_already_liquidated_bypass' };
      }
      throw error;
    }
  }

  async createProposalOnChain(
    governanceAddress: string,
    description: string,
    duration: number,
  ) {
    const governanceAbi = [
      'function createProposal(string memory _description, uint256 _duration) external',
    ];
    const govContract = new ethers.Contract(
      governanceAddress,
      governanceAbi,
      this.managedSigner,
    );
    const tx = await govContract.createProposal(description, duration);
    await tx.wait();
    return tx;
  }

  async executeProposalOnChain(governanceAddress: string, proposalId: number) {
    const governanceAbi = [
      'function executeProposal(uint256 _proposalId) external',
    ];
    const govContract = new ethers.Contract(
      governanceAddress,
      governanceAbi,
      this.managedSigner,
    );
    const tx = await govContract.executeProposal(proposalId);
    await tx.wait();
    return tx;
  }

  async getProposalStatus(governanceAddress: string, proposalId: number) {
    const governanceAbi = [
      'function proposals(uint256) view returns (string description, uint256 voteYes, uint256 voteNo, uint256 deadline, bool executed, bool exists)',
    ];
    const govContract = new ethers.Contract(
      governanceAddress,
      governanceAbi,
      this.provider,
    );
    return await govContract.proposals(proposalId);
  }

  async ensureWalletWhitelisted(walletAddress: string) {
    if (!ethers.isAddress(walletAddress)) {
      throw new Error(`Invalid wallet address format: ${walletAddress}`);
    }

    const isClear = await this.registryContract.isClearToTrade(walletAddress);
    if (!isClear) {
      this.logger.warn(
        `⚠️ Wallet ${walletAddress} is not whitelisted. Auto-registering...`,
      );
      const tx = await this.registerIdentity(walletAddress, true);
      await tx.wait();
      this.logger.log(
        `✅ Wallet ${walletAddress} successfully whitelisted on-chain.`,
      );
    }
  }

  async getAssetTokenBalance(
    tokenAddress: string,
    walletAddress: string,
  ): Promise<string> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address account) view returns (uint256)'],
      this.provider,
    );
    const balance = await tokenContract.balanceOf(walletAddress);
    return balance.toString();
  }

  async mintTokensToVault(
    tokenAddress: string,
    treasuryAddress: string,
    totalSharesWei: string,
  ) {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        'function transfer(address to, uint256 amount) external returns (bool)',
        'function balanceOf(address account) view returns (uint256)',
      ],
      this.managedSigner,
    );

    this.logger.log(
      `Funding Treasury Vault (${treasuryAddress}) with initial supply: ${totalSharesWei}`,
    );

    const tx = await tokenContract.transfer(
      treasuryAddress,
      BigInt(totalSharesWei),
    );
    await tx.wait();

    this.logger.log(`✅ Treasury Vault successfully funded. Tx: ${tx.hash}`);
    return tx;
  }
}
