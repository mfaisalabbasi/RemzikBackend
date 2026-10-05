// src/services/blockchain.service.ts

import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers, Wallet, NonceManager } from 'ethers';
import { PrivyClient } from '@privy-io/node';

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

  private privy: PrivyClient;

  private chainId: number;

  /**
   * TreasuryVault.deposit(...)
   */
  private readonly treasuryVaultInterface = new ethers.Interface([
    'function deposit(address stablecoin, uint256 amount) external',
    'event StablecoinDeposited(address indexed investor, bytes32 indexed propertyId, address indexed stablecoin, uint256 amount, uint256 timestamp)',
  ]);

  /**
   * ERC20 events / read methods.
   */
  private readonly erc20Interface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) external returns (bool)',
  ]);

  constructor(private readonly configService: ConfigService) {
    const rpcUrl =
      this.configService.get<string>('BLOCKCHAIN_RPC_URL') ||
      this.configService.get<string>('RPC_URL');

    if (!rpcUrl) {
      throw new Error('BLOCKCHAIN_RPC_URL/RPC_URL is not configured.');
    }

    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY');

    if (!privateKey) {
      throw new Error('ADMIN_PRIVATE_KEY is not configured.');
    }

    this.chainId = Number(this.configService.get<string>('CHAIN_ID') || 31337);

    if (!Number.isInteger(this.chainId) || this.chainId <= 0) {
      throw new Error(`Invalid CHAIN_ID: ${this.chainId}`);
    }

    /**
     * IMPORTANT:
     *
     * Do not use "base-mainnet" as the network name when running
     * Hardhat/local development.
     *
     * The chainId is authoritative.
     */
    const networkName =
      this.configService.get<string>('BLOCKCHAIN_NETWORK_NAME') ||
      `remzik-${this.chainId}`;

    const network = {
      name: networkName,
      chainId: this.chainId,
    };

    this.provider = new ethers.JsonRpcProvider(rpcUrl, network, {
      staticNetwork: true,
    });

    this.adminWallet = new ethers.Wallet(privateKey, this.provider);

    /**
     * IMPORTANT:
     *
     * This signer is ONLY for backend/platform/admin operations.
     *
     * It must NEVER be used to sign an investor's primary investment.
     */
    this.managedSigner = new NonceManager(this.adminWallet);

    this.privy = new PrivyClient({
      appId: this.configService.get<string>('PRIVY_APP_ID') || '',
      appSecret: this.configService.get<string>('PRIVY_APP_SECRET') || '',
    });

    const registryAddress = this.configService.get<string>(
      'COMPLIANCE_CONTRACT_ADDRESS',
    );

    const factoryAddress = this.configService.get<string>(
      'ASSET_FACTORY_CONTRACT_ADDRESS',
    );

    const marketplaceAddress = this.configService.get<string>(
      'MARKETPLACE_CONTRACT_ADDRESS',
    );

    const yieldNotaryAddress = this.configService.get<string>(
      'YIELD_NOTARY_ADDRESS',
    );

    if (!registryAddress) {
      throw new Error('COMPLIANCE_CONTRACT_ADDRESS is missing.');
    }

    if (!factoryAddress) {
      throw new Error('ASSET_FACTORY_CONTRACT_ADDRESS is missing.');
    }

    if (!marketplaceAddress) {
      throw new Error('MARKETPLACE_CONTRACT_ADDRESS is missing.');
    }

    if (!yieldNotaryAddress) {
      throw new Error('YIELD_NOTARY_ADDRESS is missing.');
    }

    this.registryContract = new ethers.Contract(
      registryAddress,
      (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI,
      this.managedSigner,
    );

    this.factoryContract = new ethers.Contract(
      factoryAddress,
      (AssetFactoryABI as any).abi || AssetFactoryABI,
      this.managedSigner,
    );

    const marketplaceAbi = [
      'function createListing(string calldata listingId, address token, uint256 amount) external',
      'function settleTrade(string calldata listingId, address seller, address buyer, uint256 tradePrice) external',
      'function executeOnChainTrade(string calldata listingId, address paymentToken, uint256 paymentAmountWei) external',
      'function listings(string) view returns (address seller, address token, uint256 amount, bool active)',
      'function getListing(string calldata listingId) view returns (address seller, address token, uint256 amount, bool active)',
      'function cancelListing(string calldata listingId) external',
    ];

    this.marketplaceContract = new ethers.Contract(
      marketplaceAddress,
      marketplaceAbi,
      this.managedSigner,
    );

    this.yieldNotaryContract = new ethers.Contract(
      yieldNotaryAddress,
      (YieldNotaryABI as any).abi || YieldNotaryABI,
      this.managedSigner,
    );
  }

  // ============================================================
  // MODULE
  // ============================================================

  async onModuleInit(): Promise<void> {
    const network = await this.provider.getNetwork();

    if (Number(network.chainId) !== this.chainId) {
      throw new Error(
        `Blockchain chain mismatch. Configured=${this.chainId}, RPC=${network.chainId}`,
      );
    }

    const adminAddress = await this.adminWallet.getAddress();

    this.logger.log(
      `Blockchain Service initialized. chainId=${this.chainId}, admin=${adminAddress}`,
    );
  }

  // ============================================================
  // BASIC HELPERS
  // ============================================================

  getChainId(): number {
    return this.chainId;
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getIndexerProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getRegistryAddress(): string {
    return this.registryContract.target as string;
  }

  getFactoryAddress(): string {
    return this.factoryContract.target as string;
  }

  getMarketplaceAddress(): string {
    return this.configService.get<string>('MARKETPLACE_CONTRACT_ADDRESS')!;
  }

  getRegistryAbi(): any {
    return (RemzikIdentityRegistryABI as any).abi || RemzikIdentityRegistryABI;
  }

  getFactoryAbi(): any {
    return (AssetFactoryABI as any).abi || AssetFactoryABI;
  }

  private normalizeAddress(address: string, fieldName: string): string {
    if (!address || !ethers.isAddress(address)) {
      throw new Error(`Invalid ${fieldName}: ${address}`);
    }

    return ethers.getAddress(address);
  }

  private normalizeTxHash(txHash: string): string {
    const clean = String(txHash || '').trim();

    if (!/^0x[a-fA-F0-9]{64}$/.test(clean)) {
      throw new Error('Invalid blockchain transaction hash.');
    }

    return clean;
  }

  private formatBatchIdToBytes32(batchId: string): string {
    const cleanId = batchId.trim();

    if (cleanId.startsWith('0x') && cleanId.length === 66) {
      return cleanId;
    }

    return ethers.id(cleanId);
  }

  // ============================================================
  // INVESTOR-SIGNED PRIMARY INVESTMENT
  // ============================================================

  /**
   * Builds the exact calldata that the INVESTOR's Privy wallet
   * must sign.
   *
   * IMPORTANT:
   *
   * This method DOES NOT send the transaction.
   */
  async buildInvestmentCalldata(params: {
    treasuryVaultAddress: string;
    stablecoinAddress?: string;
    amount: number | string;
    decimals?: number;
  }): Promise<{
    targetContract: string;
    encodedData: string;
    valueWei: bigint;
    stablecoinAddress: string;
    stablecoinAmountWei: bigint;
    chainId: number;
  }> {
    const treasuryVaultAddress = this.normalizeAddress(
      params.treasuryVaultAddress,
      'treasuryVaultAddress',
    );

    const stablecoinAddress =
      params.stablecoinAddress ||
      this.configService.get<string>('DEFAULT_STABLECOIN_ADDRESS');

    if (!stablecoinAddress) {
      throw new Error('Stablecoin address is required.');
    }

    const normalizedStablecoin = this.normalizeAddress(
      stablecoinAddress,
      'stablecoinAddress',
    );

    const decimals = params.decimals ?? 6;

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error(`Invalid stablecoin decimals: ${decimals}`);
    }

    const amountString = String(params.amount).trim();

    if (!amountString || Number(amountString) <= 0) {
      throw new Error(`Invalid investment amount: ${amountString}`);
    }

    const amountWei = ethers.parseUnits(amountString, decimals);

    const encodedData = this.treasuryVaultInterface.encodeFunctionData(
      'deposit',
      [normalizedStablecoin, amountWei],
    );

    return {
      targetContract: treasuryVaultAddress,
      encodedData,
      valueWei: 0n,
      stablecoinAddress: normalizedStablecoin,
      stablecoinAmountWei: amountWei,
      chainId: this.chainId,
    };
  }

  /**
   * Reads ERC20 decimals directly from the token contract.
   *
   * Do not hardcode 6/18 when the actual contract can be queried.
   */
  async getTokenDecimals(tokenAddress: string): Promise<number> {
    const normalized = this.normalizeAddress(tokenAddress, 'tokenAddress');

    const tokenContract = new ethers.Contract(
      normalized,
      ['function decimals() view returns (uint8)'],
      this.provider,
    );

    const decimals = await tokenContract.decimals();

    return Number(decimals);
  }

  /**
   * Reads an investor's stablecoin allowance.
   *
   * IMPORTANT:
   *
   * This checks the INVESTOR wallet, not adminWallet.
   */
  async getTokenAllowance(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
  ): Promise<bigint> {
    const token = this.normalizeAddress(tokenAddress, 'tokenAddress');

    const owner = this.normalizeAddress(ownerAddress, 'ownerAddress');

    const spender = this.normalizeAddress(spenderAddress, 'spenderAddress');

    const tokenContract = new ethers.Contract(
      token,
      [
        'function allowance(address owner, address spender) view returns (uint256)',
      ],
      this.provider,
    );

    return BigInt(await tokenContract.allowance(owner, spender));
  }

  /**
   * Checks whether the investor has enough allowance for
   * TreasuryVault.deposit().
   *
   * This does NOT approve anything.
   */
  async hasInvestorTokenAllowance(params: {
    tokenAddress: string;
    investorAddress: string;
    vaultAddress: string;
    amountWei: bigint;
  }): Promise<boolean> {
    const allowance = await this.getTokenAllowance(
      params.tokenAddress,
      params.investorAddress,
      params.vaultAddress,
    );

    return allowance >= params.amountWei;
  }

  /**
   * Reads ERC20 balance.
   */
  async getTokenBalance(
    tokenAddress: string,
    walletAddress: string,
  ): Promise<bigint> {
    const token = this.normalizeAddress(tokenAddress, 'tokenAddress');

    const wallet = this.normalizeAddress(walletAddress, 'walletAddress');

    const tokenContract = new ethers.Contract(
      token,
      ['function balanceOf(address account) view returns (uint256)'],
      this.provider,
    );

    return BigInt(await tokenContract.balanceOf(wallet));
  }

  /**
   * SECURITY-CRITICAL:
   *
   * This method verifies the ACTUAL blockchain transaction
   * submitted by the investor's Privy wallet.
   *
   * The backend never signs the transaction.
   */
  async verifyInvestmentTransaction(params: {
    txHash: string;
    expectedSender: string;
    expectedTarget: string;
    expectedStablecoin: string;
    expectedStablecoinAmountWei: bigint;
    expectedCalldata: string;
    expectedTokenAddress?: string;
    expectedTokenAmountWei?: bigint;
  }): Promise<{
    success: boolean;
    status: 'NOT_FOUND' | 'PENDING' | 'FAILED' | 'INVALID' | 'CONFIRMED';

    reason?: string;

    txHash: string;
    sender?: string;
    target?: string;
    stablecoinAmountWei?: bigint;
    tokenAmountWei?: bigint;
  }> {
    const txHash = this.normalizeTxHash(params.txHash);

    const expectedSender = this.normalizeAddress(
      params.expectedSender,
      'expectedSender',
    );

    const expectedTarget = this.normalizeAddress(
      params.expectedTarget,
      'expectedTarget',
    );

    const expectedStablecoin = this.normalizeAddress(
      params.expectedStablecoin,
      'expectedStablecoin',
    );

    const tx = await this.provider.getTransaction(txHash);

    if (!tx) {
      return {
        success: false,
        status: 'NOT_FOUND',
        reason:
          'Transaction has not reached the configured blockchain RPC yet.',
        txHash,
      };
    }

    /**
     * Verify network.
     */
    const network = await this.provider.getNetwork();

    if (Number(network.chainId) !== this.chainId) {
      throw new Error(
        `Blockchain RPC chain mismatch. Expected ${this.chainId}, got ${network.chainId}`,
      );
    }

    /**
     * Verify sender.
     */
    if (tx.from.toLowerCase() !== expectedSender.toLowerCase()) {
      return {
        success: false,
        status: 'INVALID',
        reason: 'Transaction sender does not match the investment wallet.',
        txHash,
        sender: tx.from,
        target: tx.to || undefined,
      };
    }

    /**
     * Verify target.
     */
    if (!tx.to || tx.to.toLowerCase() !== expectedTarget.toLowerCase()) {
      return {
        success: false,
        status: 'INVALID',
        reason: 'Transaction target is not the expected TreasuryVault.',
        txHash,
        sender: tx.from,
        target: tx.to || undefined,
      };
    }

    /**
     * Verify native value.
     *
     * TreasuryVault.deposit() should not receive ETH/native currency.
     */
    if (tx.value !== 0n) {
      return {
        success: false,
        status: 'INVALID',
        reason:
          'Investment transaction contains unexpected native currency value.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    /**
     * Verify exact calldata.
     *
     * This protects against:
     *
     * investor signs transaction to correct vault
     * but calls different deposit parameters.
     */
    if (tx.data.toLowerCase() !== params.expectedCalldata.toLowerCase()) {
      return {
        success: false,
        status: 'INVALID',
        reason: 'Transaction calldata does not match the investment intent.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    const receipt = await this.provider.getTransactionReceipt(txHash);

    /**
     * Transaction broadcast but not mined yet.
     */
    if (!receipt) {
      return {
        success: false,
        status: 'PENDING',
        reason: 'Transaction has been broadcast but is not mined yet.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    /**
     * EVM execution reverted.
     */
    if (receipt.status !== 1) {
      return {
        success: false,
        status: 'FAILED',
        reason: 'Blockchain transaction reverted.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    // ----------------------------------------------------------
    // Decode deposit calldata
    // ----------------------------------------------------------

    let decodedDeposit: readonly any[];

    try {
      decodedDeposit = this.treasuryVaultInterface.decodeFunctionData(
        'deposit',
        tx.data,
      );
    } catch {
      return {
        success: false,
        status: 'INVALID',
        reason: 'Unable to decode TreasuryVault.deposit calldata.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    const decodedStablecoin = this.normalizeAddress(
      decodedDeposit[0],
      'decodedStablecoin',
    );

    const decodedAmount = BigInt(decodedDeposit[1]);

    if (decodedStablecoin.toLowerCase() !== expectedStablecoin.toLowerCase()) {
      return {
        success: false,
        status: 'INVALID',
        reason:
          'Stablecoin in transaction does not match the investment intent.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    if (decodedAmount !== params.expectedStablecoinAmountWei) {
      return {
        success: false,
        status: 'INVALID',
        reason: 'Stablecoin amount does not match the investment intent.',
        txHash,
        sender: tx.from,
        target: tx.to,
        stablecoinAmountWei: decodedAmount,
      };
    }

    // ----------------------------------------------------------
    // Verify StablecoinDeposited event
    // ----------------------------------------------------------

    let depositEventFound = false;

    let actualStablecoinAmount: bigint | undefined;

    for (const log of receipt.logs) {
      try {
        const parsed = this.treasuryVaultInterface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });

        if (parsed && parsed.name === 'StablecoinDeposited') {
          const investor = this.normalizeAddress(
            parsed.args[0],
            'deposit investor',
          );

          const stablecoin = this.normalizeAddress(
            parsed.args[2],
            'deposit stablecoin',
          );

          const amount = BigInt(parsed.args[3]);

          if (
            investor.toLowerCase() === expectedSender.toLowerCase() &&
            stablecoin.toLowerCase() === expectedStablecoin.toLowerCase() &&
            amount === params.expectedStablecoinAmountWei
          ) {
            depositEventFound = true;
            actualStablecoinAmount = amount;
          }
        }
      } catch {
        /**
         * Not a TreasuryVault event.
         */
      }
    }

    if (!depositEventFound) {
      return {
        success: false,
        status: 'INVALID',
        reason:
          'TreasuryVault StablecoinDeposited event was not found with the expected investor, stablecoin and amount.',
        txHash,
        sender: tx.from,
        target: tx.to,
      };
    }

    // ----------------------------------------------------------
    // Verify stablecoin Transfer investor -> vault
    // ----------------------------------------------------------

    let stablecoinTransferFound = false;

    for (const log of receipt.logs) {
      try {
        const parsed = this.erc20Interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });

        if (parsed && parsed.name === 'Transfer') {
          const from = this.normalizeAddress(
            parsed.args[0],
            'stablecoin transfer from',
          );

          const to = this.normalizeAddress(
            parsed.args[1],
            'stablecoin transfer to',
          );

          const amount = BigInt(parsed.args[2]);

          if (
            from.toLowerCase() === expectedSender.toLowerCase() &&
            to.toLowerCase() === expectedTarget.toLowerCase() &&
            amount === params.expectedStablecoinAmountWei
          ) {
            stablecoinTransferFound = true;
            break;
          }
        }
      } catch {
        /**
         * Not an ERC20 Transfer event we need.
         */
      }
    }

    if (!stablecoinTransferFound) {
      return {
        success: false,
        status: 'INVALID',
        reason:
          'Expected stablecoin transfer from investor to TreasuryVault was not found.',
        txHash,
        sender: tx.from,
        target: tx.to,
        stablecoinAmountWei: actualStablecoinAmount,
      };
    }

    // ----------------------------------------------------------
    // Verify AssetToken Transfer vault -> investor
    // ----------------------------------------------------------

    let tokenTransferFound = false;
    let actualTokenAmount: bigint | undefined;

    if (params.expectedTokenAddress) {
      const expectedToken = this.normalizeAddress(
        params.expectedTokenAddress,
        'expectedTokenAddress',
      );

      for (const log of receipt.logs) {
        try {
          const parsed = this.erc20Interface.parseLog({
            topics: [...log.topics],
            data: log.data,
          });

          if (parsed && parsed.name === 'Transfer') {
            const from = this.normalizeAddress(
              parsed.args[0],
              'asset token transfer from',
            );

            const to = this.normalizeAddress(
              parsed.args[1],
              'asset token transfer to',
            );

            const amount = BigInt(parsed.args[2]);

            if (
              from.toLowerCase() === expectedTarget.toLowerCase() &&
              to.toLowerCase() === expectedSender.toLowerCase()
            ) {
              if (
                params.expectedTokenAmountWei !== undefined &&
                amount !== params.expectedTokenAmountWei
              ) {
                continue;
              }

              tokenTransferFound = true;
              actualTokenAmount = amount;
              break;
            }
          }
        } catch {
          /**
           * Ignore unrelated logs.
           */
        }
      }

      if (!tokenTransferFound) {
        return {
          success: false,
          status: 'INVALID',
          reason:
            'Expected asset-token transfer from TreasuryVault to investor was not found.',
          txHash,
          sender: tx.from,
          target: tx.to,
          stablecoinAmountWei: actualStablecoinAmount,
        };
      }
    }

    return {
      success: true,
      status: 'CONFIRMED',
      txHash,
      sender: tx.from,
      target: tx.to,
      stablecoinAmountWei: actualStablecoinAmount,
      tokenAmountWei: actualTokenAmount,
    };
  }

  /**
   * Generic anti-spoofing transaction check.
   *
   * Kept for other blockchain workflows.
   */
  async verifyOnChainIntent(params: {
    txHash: string;
    expectedSender: string;
    expectedTarget: string;
    expectedCalldata: string;
    expectedValue?: string | bigint;
  }): Promise<{
    success: boolean;
    reason?: string;
  }> {
    try {
      const txHash = this.normalizeTxHash(params.txHash);

      const tx = await this.provider.getTransaction(txHash);

      if (!tx) {
        return {
          success: false,
          reason: 'Transaction not found on-chain.',
        };
      }

      const receipt = await this.provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return {
          success: false,
          reason: 'Transaction has not been mined yet.',
        };
      }

      if (receipt.status !== 1) {
        return {
          success: false,
          reason: 'Transaction reverted on-chain.',
        };
      }

      if (tx.from.toLowerCase() !== params.expectedSender.toLowerCase()) {
        return {
          success: false,
          reason: 'Transaction sender mismatch.',
        };
      }

      if (
        !tx.to ||
        tx.to.toLowerCase() !== params.expectedTarget.toLowerCase()
      ) {
        return {
          success: false,
          reason: 'Transaction target mismatch.',
        };
      }

      if (tx.data.toLowerCase() !== params.expectedCalldata.toLowerCase()) {
        return {
          success: false,
          reason: 'Transaction calldata mismatch.',
        };
      }

      if (
        params.expectedValue !== undefined &&
        tx.value !== BigInt(params.expectedValue)
      ) {
        return {
          success: false,
          reason: 'Transaction native value mismatch.',
        };
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Error verifying on-chain intent: ${error.message}`);

      return {
        success: false,
        reason: error.message,
      };
    }
  }

  // ============================================================
  // PRIVY
  // ============================================================

  /**
   * IMPORTANT:
   *
   * This method is retained for recovery/admin workflows only.
   *
   * It must NOT be used as the investor signer for investments.
   */
  async generateEmbeddedWalletForUser(privyUserId: string): Promise<string> {
    try {
      this.logger.log(
        `Provisioning Privy recovery wallet for Privy user ${privyUserId}`,
      );

      const wallet = await this.privy.wallets().create({
        chain_type: 'ethereum',
        owner: {
          user_id: privyUserId,
        },
      });

      if (!wallet || !wallet.address) {
        throw new Error('Privy did not return a valid wallet address.');
      }

      this.logger.log(`Privy recovery wallet created: ${wallet.address}`);

      return wallet.address;
    } catch (error: any) {
      this.logger.error(`Privy wallet provisioning failed: ${error.message}`);

      throw error;
    }
  }

  /**
   * SECURITY:
   *
   * Never return adminWallet.address for an investor.
   *
   * This legacy method is deliberately disabled.
   */
  async getWalletIdForUser(_privyUserId: string): Promise<string> {
    throw new Error(
      'getWalletIdForUser() cannot return the backend admin signer. Investor transactions must be signed by the investor Privy wallet.',
    );
  }

  // ============================================================
  // ADMIN STABLECOIN ALLOWANCE
  // ============================================================

  /**
   * This method operates on ADMIN wallet funds.
   *
   * It must NOT be used to satisfy investor TreasuryVault
   * approval requirements.
   */
  async ensureTokenAllowance(
    tokenAddress: string,
    spenderAddress: string,
    amountWei: bigint,
  ): Promise<void> {
    const ownerAddress = await this.adminWallet.getAddress();

    const token = this.normalizeAddress(tokenAddress, 'tokenAddress');

    const spender = this.normalizeAddress(spenderAddress, 'spenderAddress');

    const tokenContract = new ethers.Contract(
      token,
      [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 amount) external returns (bool)',
      ],
      this.managedSigner,
    );

    const currentAllowance = BigInt(
      await tokenContract.allowance(ownerAddress, spender),
    );

    if (currentAllowance >= amountWei) {
      return;
    }

    this.logger.warn(
      `Admin stablecoin allowance too low. Approving ${spender}.`,
    );

    const tx = await tokenContract.approve(spender, ethers.MaxUint256);

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Admin stablecoin approval transaction failed.');
    }

    this.logger.log(`Admin stablecoin approval confirmed: ${tx.hash}`);
  }

  // ============================================================
  // ADMIN SERVER-SIDE TRANSACTIONS
  // ============================================================

  /**
   * Backend/admin transaction execution.
   *
   * NEVER use this for investor primary investment signing.
   */
  async executeServerSideTransaction(params: {
    targetContract: string;
    encodedData: string;
    valueWei?: string | bigint;
  }): Promise<ethers.TransactionReceipt> {
    try {
      const target = this.normalizeAddress(
        params.targetContract,
        'targetContract',
      );

      let cleanData = params.encodedData
        ? String(params.encodedData).trim()
        : '0x';

      if (!cleanData.startsWith('0x')) {
        cleanData = `0x${cleanData}`;
      }

      const value =
        params.valueWei !== undefined ? BigInt(params.valueWei) : 0n;

      const tx = await this.managedSigner.sendTransaction({
        to: target,
        data: cleanData,
        value,
      });

      this.logger.log(`Admin transaction broadcast: ${tx.hash}`);

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error(`Admin blockchain transaction failed: ${tx.hash}`);
      }

      return receipt;
    } catch (error: any) {
      this.logger.error(`Admin blockchain execution failed: ${error.message}`);

      throw new InternalServerErrorException(
        `Blockchain execution failed: ${error.message}`,
      );
    }
  }

  // ============================================================
  // WALLET RECOVERY
  // ============================================================

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
      throw new Error('RECOVERY_MANAGER_CONTRACT_ADDRESS is missing.');
    }

    const recoveryContract = new ethers.Contract(
      recoveryManagerAddress,
      [
        'function recoverWallet(address tokenAddress, address oldWallet, address newWallet, uint256 amount) external',
      ],
      this.managedSigner,
    );

    const tx = await recoveryContract.recoverWallet(
      tokenAddress,
      oldWallet,
      newWallet,
      BigInt(amount),
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Wallet recovery transaction failed.');
    }

    this.logger.log(`Wallet recovery confirmed: ${tx.hash}`);

    return tx.hash;
  }

  // ============================================================
  // MARKETPLACE
  // ============================================================

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

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Trade settlement failed for ${listingId}`);
    }

    return tx;
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

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Listing creation failed: ${listingId}`);
    }

    return tx;
  }

  async executeOnChainTrade(
    listingId: string,
    paymentToken: string,
    paymentAmountWei: string | bigint,
  ) {
    const tx = await this.marketplaceContract.executeOnChainTrade(
      listingId,
      paymentToken,
      BigInt(paymentAmountWei),
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`On-chain trade failed: ${listingId}`);
    }

    this.logger.log(`On-chain trade confirmed: ${tx.hash}`);

    return receipt;
  }

  async isListingActive(listingId: string): Promise<boolean> {
    try {
      const listing = await this.marketplaceContract.getListing(listingId);

      const isActive = listing.active ?? listing[3];

      const seller = listing.seller ?? listing[0];

      return Boolean(isActive) && seller !== ethers.ZeroAddress;
    } catch (error: any) {
      this.logger.error(
        `Listing verification failed for ${listingId}: ${error.message}`,
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

    const allowance = BigInt(
      await tokenContract.allowance(sellerWallet, spenderAddress),
    );

    return allowance >= ethers.parseUnits(requiredAmount, decimals);
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

    return BigInt(await tokenContract.allowance(owner, spender));
  }

  async getAssetTokenBalance(
    tokenAddress: string,
    walletAddress: string,
  ): Promise<string> {
    const balance = await this.getTokenBalance(tokenAddress, walletAddress);

    return balance.toString();
  }

  // ============================================================
  // ASSET FACTORY
  // ============================================================

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
        'TOKEN_DEPLOYER_ADDRESS or GOV_DEPLOYER_ADDRESS is missing.',
      );
    }

    if (
      tokenDeployer === ethers.ZeroAddress ||
      govDeployer === ethers.ZeroAddress ||
      tokenDeployer.toLowerCase() !== envTokenDeployer.toLowerCase() ||
      govDeployer.toLowerCase() !== envGovDeployer.toLowerCase()
    ) {
      this.logger.warn('Linking deployers to AssetFactory...');

      const tx = await this.factoryContract.setDeployers(
        envTokenDeployer,
        envGovDeployer,
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('Failed to link AssetFactory deployers.');
      }

      return tx;
    }

    return undefined;
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

    if (!tokenBytecode) {
      throw new Error('RemzikAssetToken bytecode is missing.');
    }

    if (!govBytecode) {
      throw new Error('PropertyGovernance bytecode is missing.');
    }

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
      ['string', 'string', 'string', 'address', 'address', 'address'],
      [
        name,
        symbol,
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
      BigInt(supply),
      formattedPropertyId,
      adminWalletAddress,
      {
        gasLimit: 5_000_000n,
      },
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      throw new Error('Asset deployment failed.');
    }

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
      } catch {
        // Ignore unrelated logs.
      }
    }

    if (
      !deployedGovAddress ||
      !deployedTokenAddress ||
      !deployedTreasuryAddress
    ) {
      throw new Error(
        'AssetPodDeployed event did not provide all deployed addresses.',
      );
    }

    const govContract = new ethers.Contract(
      deployedGovAddress,
      [
        'function setToken(address _token) external',
        'function token() view returns (address)',
      ],
      this.managedSigner,
    );

    const existingToken = await govContract.token();

    if (existingToken === ethers.ZeroAddress) {
      const linkTx = await govContract.setToken(deployedTokenAddress);

      const linkReceipt = await linkTx.wait();

      if (!linkReceipt || linkReceipt.status !== 1) {
        throw new Error('Failed to link token to governance.');
      }
    }

    return {
      tokenAddress: deployedTokenAddress,
      treasuryAddress: deployedTreasuryAddress,
      governanceAddress: deployedGovAddress,
    };
  }

  // ============================================================
  // ADMIN PRICE ORACLE
  // ============================================================

  async updatePriceBandOnChain(tokenAddress: string, min: string, max: string) {
    const oracleAddress = this.configService.get<string>(
      'PRICE_ORACLE_CONTRACT_ADDRESS',
    );

    if (!oracleAddress) {
      throw new Error('PRICE_ORACLE_CONTRACT_ADDRESS is missing.');
    }

    const oracleContract = new ethers.Contract(
      oracleAddress,
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

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Price band update failed.');
    }

    return tx;
  }

  // ============================================================
  // COMPLIANCE
  // ============================================================

  async registerIdentity(investorWallet: string, status: boolean) {
    const wallet = this.normalizeAddress(investorWallet, 'investorWallet');

    const tx = await this.registryContract.registerIdentity(wallet, status);

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Identity registration failed for ${wallet}`);
    }

    return tx;
  }

  async toggleFreeze(investorWallet: string, shouldFreeze: boolean) {
    const wallet = this.normalizeAddress(investorWallet, 'investorWallet');

    const tx = await this.registryContract.toggleFreeze(wallet, shouldFreeze);

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Identity freeze update failed for ${wallet}`);
    }

    return tx;
  }

  async isVerified(investorWallet: string): Promise<boolean> {
    const wallet = this.normalizeAddress(investorWallet, 'investorWallet');

    return Boolean(await this.registryContract.isClearToTrade(wallet));
  }

  /**
   * IMPORTANT:
   *
   * Automatic KYC registration should only be called from an
   * explicitly authorized compliance workflow.
   */
  async ensureWalletWhitelisted(walletAddress: string) {
    const wallet = this.normalizeAddress(walletAddress, 'walletAddress');

    const isClear = await this.registryContract.isClearToTrade(wallet);

    if (!isClear) {
      this.logger.warn(`Wallet ${wallet} is not whitelisted.`);

      const tx = await this.registerIdentity(wallet, true);

      this.logger.log(`Wallet ${wallet} registered on-chain: ${tx.hash}`);

      return tx;
    }

    return undefined;
  }

  // ============================================================
  // TREASURY TOKEN RELEASE
  // ============================================================

  /**
   * LEGACY / ADMIN WORKFLOW.
   *
   * This is NOT used by the new investor-signed primary
   * investment flow.
   */
  async transferFromTreasuryVault(
    tokenAddress: string,
    treasuryAddress: string,
    to: string,
    amountUnits: string,
    decimals = 18,
  ): Promise<ethers.TransactionReceipt> {
    const token = this.normalizeAddress(tokenAddress, 'tokenAddress');

    const treasury = this.normalizeAddress(treasuryAddress, 'treasuryAddress');

    const recipient = this.normalizeAddress(to, 'recipient');

    const tokenContract = new ethers.Contract(
      token,
      [
        'function balanceOf(address account) view returns (uint256)',
        'function paused() view returns (bool)',
      ],
      this.provider,
    );

    const isPaused = await tokenContract.paused().catch(() => false);

    if (isPaused) {
      throw new Error('Asset token is paused.');
    }

    const parsedAmount = ethers.parseUnits(amountUnits, decimals);

    const vaultBalance = BigInt(await tokenContract.balanceOf(treasury));

    if (vaultBalance < parsedAmount) {
      throw new Error(
        `TreasuryVault balance insufficient. Required=${parsedAmount}, available=${vaultBalance}`,
      );
    }

    const treasuryVaultContract = new ethers.Contract(
      treasury,
      [
        'function releaseTokens(address token, address to, uint256 amount) external',
      ],
      this.managedSigner,
    );

    const tx = await treasuryVaultContract.releaseTokens(
      token,
      recipient,
      parsedAmount,
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('TreasuryVault token release failed.');
    }

    return receipt;
  }

  // ============================================================
  // YIELD
  // ============================================================

  async recordYieldOnChain(
    batchId: string,
    propertyAddress: string,
    totalNetYieldWei: string,
  ) {
    const hashedBatchId = this.formatBatchIdToBytes32(batchId);

    const tx = await this.yieldNotaryContract.recordYield(
      hashedBatchId,
      propertyAddress,
      BigInt(totalNetYieldWei),
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Yield recording failed for batch ${batchId}`);
    }

    return tx;
  }

  async recordYieldWithMerkleOnChain(
    batchId: string,
    propertyAddress: string,
    merkleRoot: string,
    totalOnChainAmountWei: string,
  ) {
    this.logger.log(`Anchoring Merkle root ${merkleRoot} for batch ${batchId}`);

    const hashedBatchId = this.formatBatchIdToBytes32(batchId);

    const tx = await this.yieldNotaryContract.recordYieldWithMerkle(
      hashedBatchId,
      propertyAddress,
      merkleRoot,
      BigInt(totalOnChainAmountWei),
      {
        gasLimit: 300_000n,
      },
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      throw new InternalServerErrorException(
        `YieldNotary.recordYieldWithMerkle reverted for batch ${batchId}`,
      );
    }

    this.logger.log(`Merkle root anchored: ${tx.hash}`);

    return receipt;
  }

  // ============================================================
  // GOVERNANCE
  // ============================================================

  async triggerLiquidationOnChain(governanceAddress: string) {
    const governance = this.normalizeAddress(
      governanceAddress,
      'governanceAddress',
    );

    const governanceContract = new ethers.Contract(
      governance,
      ['function emergencyLiquidate() external'],
      this.managedSigner,
    );

    try {
      const tx = await governanceContract.emergencyLiquidate({
        gasLimit: 150_000n,
      });

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('Emergency liquidation transaction failed.');
      }

      return tx;
    } catch (error: any) {
      /**
       * DO NOT return a fake transaction hash.
       *
       * If the contract is already liquidated, the service layer
       * should explicitly inspect on-chain state and return an
       * already-liquidated status.
       */
      if (
        error.message?.includes('EnforcedPause') ||
        error.data === '0xd93c0665'
      ) {
        this.logger.warn(
          `Governance contract ${governance} appears to already be paused/liquidated.`,
        );

        return {
          alreadyLiquidated: true,
          governanceAddress: governance,
        };
      }

      throw error;
    }
  }

  async createProposalOnChain(
    governanceAddress: string,
    description: string,
    duration: number,
  ) {
    const governanceContract = new ethers.Contract(
      governanceAddress,
      [
        'function createProposal(string memory _description, uint256 _duration) external',
      ],
      this.managedSigner,
    );

    const tx = await governanceContract.createProposal(description, duration);

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Proposal creation failed.');
    }

    return tx;
  }

  async executeProposalOnChain(governanceAddress: string, proposalId: number) {
    const governanceContract = new ethers.Contract(
      governanceAddress,
      ['function executeProposal(uint256 _proposalId) external'],
      this.managedSigner,
    );

    const tx = await governanceContract.executeProposal(proposalId);

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Proposal execution failed: ${proposalId}`);
    }

    return tx;
  }

  async getProposalStatus(governanceAddress: string, proposalId: number) {
    const governanceContract = new ethers.Contract(
      governanceAddress,
      [
        'function proposals(uint256) view returns (string description, uint256 voteYes, uint256 voteNo, uint256 deadline, bool executed, bool exists)',
      ],
      this.provider,
    );

    return governanceContract.proposals(proposalId);
  }

  // ============================================================
  // ON-CHAIN MARKET / GOVERNANCE HELPERS
  // ============================================================

  async updatePriceBand(tokenAddress: string, min: string, max: string) {
    return this.updatePriceBandOnChain(tokenAddress, min, max);
  }
}
