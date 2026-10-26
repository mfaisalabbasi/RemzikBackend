import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import * as TypeORM from 'typeorm';
import * as Bull from 'bull';

import { ethers } from 'ethers';

import { Investment } from './investment.entity';

import {
  CreateInvestmentDto,
  SettlementMode,
} from './dto/create-investment.dto';

import { CreateInvestmentIntentDto } from './dto/create-investment-intent.dto';

import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { AssetToken } from 'src/tokenization/entities/asset-token.entity';

import { InvestmentStatus } from './enums/investment-status.enum';

import { OwnershipService } from 'src/ownership/ownership.service';
import { WalletService } from 'src/wallet/wallet.service';

import { NotificationOrchestrator } from 'src/notifications/notifications.orchestrator';

import { Ownership } from 'src/ownership/ownership.entity';

import { BlockchainService } from 'src/blockchain/blockchain.service';

import { Distribution } from '../distribution/distribution.entity';

import { DataSource } from 'typeorm';

@Injectable()
export class InvestmentService {
  private readonly logger = new Logger(InvestmentService.name);

  private readonly provider: ethers.JsonRpcProvider;

  /**
   * TreasuryVault interface.
   */
  private readonly vaultInterface = new ethers.Interface([
    'function deposit(address stablecoin,uint256 amount)',

    'event StablecoinDeposited(' +
      'address indexed investor,' +
      'bytes32 indexed propertyId,' +
      'address indexed stablecoin,' +
      'uint256 amount,' +
      'uint256 timestamp' +
      ')',
  ]);

  /**
   * ERC20 interface.
   */
  private readonly erc20Interface = new ethers.Interface([
    'event Transfer(' +
      'address indexed from,' +
      'address indexed to,' +
      'uint256 value' +
      ')',
  ]);

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: TypeORM.Repository<Investment>,

    @InjectRepository(AssetToken)
    private readonly assetTokenRepo: TypeORM.Repository<AssetToken>,

    @InjectRepository(Distribution)
    private readonly distributionRepo: TypeORM.Repository<Distribution>,

    @InjectQueue('investment-queue')
    private readonly investmentQueue: Bull.Queue,

    private readonly configService: ConfigService,

    private readonly notificationOrchestrator: NotificationOrchestrator,

    private readonly ownershipService: OwnershipService,

    private readonly walletService: WalletService,

    private readonly blockchainService: BlockchainService,

    private readonly dataSource: DataSource,
  ) {
    const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL');

    if (!rpcUrl) {
      throw new Error('BLOCKCHAIN_RPC_URL is required.');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  // =========================================================
  // BASIC QUERY
  // =========================================================

  async getById(id: string): Promise<Investment | null> {
    return this.investmentRepo.findOne({
      where: { id },
    });
  }

  // =========================================================
  // OFF-CHAIN INVESTMENT
  // =========================================================

  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    const settlementMode = dto.settlementMode || SettlementMode.OFF_CHAIN;

    if (settlementMode === SettlementMode.ON_CHAIN) {
      throw new BadRequestException(
        'Use /investments/intent for on-chain settlement.',
      );
    }

    // Generate an internal reference/job ID automatically if it's off-chain
    const transactionId =
      dto.transactionId ||
      `OFFCHAIN-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const savedInvestment = await this.investmentRepo.manager.transaction(
      async (manager) => {
        const availableBalance =
          await this.walletService.getAvailableBalance(userId);

        if (availableBalance < Number(dto.amount)) {
          throw new BadRequestException('Insufficient balance.');
        }

        const investor = await manager.findOne(InvestorProfile, {
          where: {
            user: {
              id: userId,
            },
          },
          relations: ['user'],
        });

        if (!investor) {
          throw new BadRequestException('Investor profile not found.');
        }

        const token = await manager
          .getRepository(AssetToken)
          .createQueryBuilder('token')
          .setLock('pessimistic_write')
          .where('token.assetId = :assetId', {
            assetId: dto.assetId,
          })
          .getOne();

        if (!token) {
          throw new BadRequestException('Asset is not tokenized.');
        }

        const amount = Number(dto.amount);
        const sharePrice = Number(token.sharePrice);

        if (!Number.isFinite(amount) || amount <= 0) {
          throw new BadRequestException(
            'Investment amount must be greater than zero.',
          );
        }

        if (!Number.isFinite(sharePrice) || sharePrice <= 0) {
          throw new BadRequestException('Asset share price is invalid.');
        }

        const shares = this.calculateShares(amount, sharePrice);

        if (shares > Number(token.availableShares)) {
          throw new BadRequestException('Not enough shares available.');
        }

        token.availableShares = Number(token.availableShares) - shares;

        await manager.save(token);

        const asset = await manager.findOne(Asset, {
          where: {
            id: dto.assetId,
          },
          relations: ['partner', 'partner.user'],
        });

        if (!asset) {
          throw new BadRequestException('Asset not found.');
        }

        const investment = manager.create(Investment, {
          investor,
          asset: {
            id: dto.assetId,
          } as Asset,
          amount,
          units: shares,
          unitPriceAtPurchase: sharePrice,
          status: InvestmentStatus.PENDING,
        });

        const saved = await manager.save(investment);

        await this.investmentQueue.add(
          'process-investment',
          {
            investmentId: saved.id,
          },
          {
            jobId: transactionId,
            attempts: 3,
            removeOnComplete: true,
          },
        );

        return saved;
      },
    );

    // 🛡️ NOTIFICATION: Inform investor that investment request has been created/queued
    try {
      const fullSaved = await this.investmentRepo.findOne({
        where: { id: savedInvestment.id },
        relations: ['asset', 'investor', 'investor.user'],
      });
      if (fullSaved?.investor?.user?.id && fullSaved.asset) {
        await this.notificationOrchestrator.buildAndSave(
          fullSaved.investor.user.id,
          'investment.created',
          {
            title: 'Investment Request Processing',
            message: `Your investment request of SAR ${fullSaved.amount} in "${fullSaved.asset.title}" is queued for processing.`,
            amount: fullSaved.amount,
            asset: fullSaved.asset.title,
            timestamp: new Date(),
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to dispatch off-chain investment notification: ${err}`,
      );
    }

    return savedInvestment;
  }

  async finalizeTokenization(
    investmentId: string,
    txHash: string,
  ): Promise<void> {
    const confirmedInvestment = await this.investmentRepo.manager.transaction(
      async (manager) => {
        const investment = await manager.findOne(Investment, {
          where: { id: investmentId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!investment || investment.status === InvestmentStatus.CONFIRMED)
          return null;

        const fullInvestment = await manager.findOne(Investment, {
          where: { id: investmentId },
          relations: [
            'asset',
            'asset.partner',
            'asset.partner.user',
            'investor',
            'investor.user',
          ],
        });

        if (!fullInvestment) return null;

        const asset = fullInvestment.asset;
        await this.walletService.transfer(
          fullInvestment.investor.user.id,
          asset.partner.user.id,
          fullInvestment.amount,
          LedgerSource.ASSET_INVESTMENT,
          `Investment Finalized: ${asset.title}`,
          manager,
        );

        asset.funded = Number(asset.funded) + Number(fullInvestment.amount);
        const existingOwnership = await manager.findOne(Ownership, {
          where: { investorId: fullInvestment.investor.id, assetId: asset.id },
        });
        if (!existingOwnership) asset.investors = (asset.investors || 0) + 1;
        await manager.save(asset);

        await this.ownershipService.addShares(
          fullInvestment.investor,
          asset,
          fullInvestment.units,
          manager,
        );

        fullInvestment.status = InvestmentStatus.CONFIRMED;
        fullInvestment.txHash = txHash;
        return await manager.save(fullInvestment);
      },
    );

    if (confirmedInvestment) {
      const reloaded = await this.investmentRepo.findOne({
        where: { id: confirmedInvestment.id },
        relations: [
          'asset',
          'investor',
          'investor.user',
          'asset.partner',
          'asset.partner.user',
        ],
      });

      if (reloaded && reloaded.asset) {
        // 🛡️ NOTIFICATION 1: Inform Investor of confirmation
        await this.notificationOrchestrator.buildAndSave(
          reloaded.investor.user.id,
          'investment.created',
          {
            title: 'Investment Confirmed!',
            message: `Your investment of SAR ${reloaded.amount} in "${reloaded.asset.title}" is now finalized.`,
            amount: reloaded.amount,
            asset: reloaded.asset.title,
            timestamp: new Date(),
          },
        );

        // 🛡️ NOTIFICATION 2: Inform Asset Partner that capital has been allocated/funded
        if (reloaded.asset?.partner?.user?.id) {
          await this.notificationOrchestrator.buildAndSave(
            reloaded.asset.partner.user.id,
            'investment.partner.funded',
            {
              title: 'New Investment Funded',
              message: `An investment of SAR ${reloaded.amount} was successfully completed for your asset "${reloaded.asset.title}".`,
              amount: reloaded.amount,
              asset: reloaded.asset.title,
              timestamp: new Date(),
            },
          );
        }
      }
    }
  }

  // =========================================================
  // CREATE ON-CHAIN INTENT
  // =========================================================

  async createInvestmentIntent(userId: string, dto: CreateInvestmentIntentDto) {
    if (dto.settlementMode !== SettlementMode.ON_CHAIN) {
      throw new BadRequestException(
        'Investment intent requires ON_CHAIN settlement mode.',
      );
    }

    if (!dto.assetId || dto.amount === undefined || dto.amount === null) {
      throw new BadRequestException('Asset ID and amount are required.');
    }

    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // ------------------------------------------------------
      // INVESTOR
      // ------------------------------------------------------

      const investor = await queryRunner.manager.findOne(InvestorProfile, {
        where: {
          user: {
            id: userId,
          },
        },
        relations: ['user'],
      });

      if (!investor?.user) {
        throw new BadRequestException('Investor profile not found.');
      }

      const databaseWallet = investor.user.walletAddress;

      if (!databaseWallet || !ethers.isAddress(databaseWallet)) {
        throw new BadRequestException('Investor wallet is not configured.');
      }

      // ------------------------------------------------------
      // ASSET
      // ------------------------------------------------------

      const asset = await queryRunner.manager.findOne(Asset, {
        where: {
          id: dto.assetId,
        },
      });

      if (!asset) {
        throw new NotFoundException('Asset not found.');
      }

      if (!asset.treasuryAddress || !ethers.isAddress(asset.treasuryAddress)) {
        throw new BadRequestException(
          'Asset TreasuryVault is not configured correctly.',
        );
      }

      if (!asset.tokenAddress || !ethers.isAddress(asset.tokenAddress)) {
        throw new BadRequestException(
          'Asset token address is not configured correctly.',
        );
      }

      // ------------------------------------------------------
      // ASSET TOKEN
      // ------------------------------------------------------

      const token = await queryRunner.manager
        .getRepository(AssetToken)
        .createQueryBuilder('token')
        .setLock('pessimistic_write')
        .where('token.assetId = :assetId', {
          assetId: dto.assetId,
        })
        .getOne();

      if (!token) {
        throw new BadRequestException('Asset is not tokenized.');
      }

      const amount = Number(dto.amount);

      const sharePrice = Number(token.sharePrice);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(
          'Investment amount must be greater than zero.',
        );
      }

      if (!Number.isFinite(sharePrice) || sharePrice <= 0) {
        throw new BadRequestException('Asset share price is invalid.');
      }

      // ------------------------------------------------------
      // BUSINESS SHARES
      // ------------------------------------------------------

      const preciseShares = this.calculateShares(amount, sharePrice);

      if (preciseShares > Number(token.availableShares)) {
        throw new BadRequestException('Not enough shares available.');
      }

      // ------------------------------------------------------
      // TOKEN DECIMALS
      // ------------------------------------------------------

      const tokenDecimals = Number((token as any).decimals);

      if (
        !Number.isInteger(tokenDecimals) ||
        tokenDecimals < 0 ||
        tokenDecimals > 36
      ) {
        throw new BadRequestException('Invalid asset token decimals.');
      }

      // ------------------------------------------------------
      // STABLECOIN
      // ------------------------------------------------------

      const stablecoinAddress =
        (asset as any).stablecoinAddress ||
        this.configService.get<string>('DEFAULT_STABLECOIN_ADDRESS');

      if (!stablecoinAddress || !ethers.isAddress(stablecoinAddress)) {
        throw new BadRequestException(
          'Stablecoin address is not configured correctly.',
        );
      }

      const configuredDecimals = this.configService.get<string>(
        'STABLECOIN_DECIMALS',
      );

      const stablecoinDecimals = Number(configuredDecimals || '6');

      if (
        !Number.isInteger(stablecoinDecimals) ||
        stablecoinDecimals < 0 ||
        stablecoinDecimals > 36
      ) {
        throw new BadRequestException(
          'Invalid stablecoin decimals configuration.',
        );
      }

      /**
       * DTO permits max 2 decimal places.
       */
      const stablecoinAmount = ethers.parseUnits(
        amount.toFixed(2),
        stablecoinDecimals,
      );

      const expectedTokenAmount = stablecoinAmount;

      // ------------------------------------------------------
      // EXACT CALLDATA
      // ------------------------------------------------------

      const encodedData = this.vaultInterface.encodeFunctionData('deposit', [
        stablecoinAddress,
        stablecoinAmount,
      ]);

      const chainId = this.getBlockchainChainId();

      // ------------------------------------------------------
      // RESERVE SHARES
      // ------------------------------------------------------

      token.availableShares = Number(token.availableShares) - preciseShares;

      await queryRunner.manager.save(token);

      // ------------------------------------------------------
      // CREATE SNAPSHOTTED INVESTMENT
      // ------------------------------------------------------

      const investment = queryRunner.manager.create(Investment, {
        investor,

        asset: {
          id: dto.assetId,
        } as Asset,

        amount,

        units: preciseShares,

        unitPriceAtPurchase: sharePrice,

        status: InvestmentStatus.PENDING,

        settlementMode: dto.settlementMode,

        walletAddress: databaseWallet,

        expectedWalletAddress: databaseWallet,

        expectedChainId: String(chainId),

        expectedVaultAddress: asset.treasuryAddress,

        expectedCalldata: encodedData,

        expectedStablecoinAddress: stablecoinAddress,

        expectedStablecoinAmount: stablecoinAmount.toString(),

        expectedTokenAddress: asset.tokenAddress,

        expectedTokenAmount: expectedTokenAmount.toString(),
      } as any);

      const savedInvestment = await queryRunner.manager.save(
        Investment,
        investment,
      );

      await queryRunner.commitTransaction();

      // 🛡️ NOTIFICATION: Inform investor that on-chain investment intent is ready for signing/approval
      try {
        await this.notificationOrchestrator.buildAndSave(
          investor.user.id,
          'investment.intent_created',
          {
            title: 'On-Chain Investment Intent Ready',
            message: `Please sign your on-chain transaction of SAR ${amount} for "${asset.title}".`,
            amount,
            asset: asset.title,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to dispatch intent notification: ${err}`);
      }

      // ------------------------------------------------------
      // RETURN SIGNING PAYLOAD
      // ------------------------------------------------------

      const erc20Interface = new ethers.Interface([
        'function approve(address spender, uint256 amount) returns (bool)',
      ]);

      const approvalData = erc20Interface.encodeFunctionData('approve', [
        asset.treasuryAddress,
        stablecoinAmount,
      ]);

      return {
        success: true,

        investmentId: savedInvestment.id,

        status: InvestmentStatus.PENDING,

        approvalPayload: {
          to: stablecoinAddress,
          data: approvalData,
          value: '0x0',
          chainId,
        },

        txPayload: {
          to: asset.treasuryAddress,

          data: encodedData,

          value: '0x0',

          chainId,
        },

        expectedWalletAddress: databaseWallet,

        expectedStablecoinAddress: stablecoinAddress,

        expectedStablecoinAmount: stablecoinAmount.toString(),

        expectedTokenAmount: expectedTokenAmount.toString(),

        expiresAt: null,
      };
    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      this.logger.error(
        `Failed to create investment intent: ${error?.message}`,
        error?.stack,
      );

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // =========================================================
  // SUBMIT INVESTOR TRANSACTION
  // =========================================================

  async submitOnChainTransaction(
    userId: string,
    investmentId: string,
    txHash: string,
  ) {
    if (!txHash || !ethers.isHexString(txHash, 32)) {
      throw new BadRequestException('Invalid transaction hash.');
    }

    const normalizedHash = txHash.toLowerCase();

    const investment = await this.investmentRepo.findOne({
      where: {
        id: investmentId,
      },
      relations: ['investor', 'investor.user'],
    });

    if (!investment) {
      throw new NotFoundException('Investment intent not found.');
    }

    // ------------------------------------------------------
    // OWNERSHIP
    // ------------------------------------------------------

    if (investment.investor?.user?.id !== userId) {
      throw new ForbiddenException(
        'You are not authorized to submit a transaction for this investment.',
      );
    }

    // ------------------------------------------------------
    // ALREADY CONFIRMED
    // ------------------------------------------------------

    if (investment.status === InvestmentStatus.CONFIRMED) {
      if (investment.txHash?.toLowerCase() === normalizedHash) {
        return {
          success: true,
          investmentId,
          status: InvestmentStatus.CONFIRMED,
          txHash: investment.txHash,
        };
      }

      throw new ConflictException(
        'This investment has already been finalized with another transaction.',
      );
    }

    // ------------------------------------------------------
    // ALREADY FAILED
    // ------------------------------------------------------

    if (investment.status === InvestmentStatus.FAILED) {
      throw new ConflictException('This investment has already failed.');
    }

    // ------------------------------------------------------
    // CHECK WHETHER HASH BELONGS TO ANOTHER INVESTMENT
    // ------------------------------------------------------

    const existing = await this.investmentRepo.findOne({
      where: {
        txHash: normalizedHash,
      },
    });

    if (existing && existing.id !== investmentId) {
      throw new ConflictException(
        'This blockchain transaction is already associated with another investment.',
      );
    }

    // ------------------------------------------------------
    // BIND TX HASH
    // ------------------------------------------------------

    await this.investmentRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Investment, {
        where: {
          id: investmentId,
        },
        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!locked) {
        throw new NotFoundException('Investment not found.');
      }

      if (locked.status === InvestmentStatus.CONFIRMED) {
        return;
      }

      if (locked.status === InvestmentStatus.FAILED) {
        throw new ConflictException('This investment has already failed.');
      }

      /**
       * Never replace a transaction hash silently.
       */
      if (locked.txHash && locked.txHash.toLowerCase() !== normalizedHash) {
        throw new ConflictException(
          'A different blockchain transaction is already processing for this investment.',
        );
      }

      locked.txHash = normalizedHash;

      locked.status = InvestmentStatus.PROCESSING;

      await manager.save(Investment, locked);
    });

    // ------------------------------------------------------
    // QUEUE BLOCKCHAIN VERIFICATION
    // ------------------------------------------------------

    await this.investmentQueue.add(
      'verify-onchain-investment',
      {
        investmentId,
        txHash: normalizedHash,
      },
      {
        jobId: `onchain-${investmentId}-${normalizedHash}`,

        attempts: 30,

        backoff: {
          type: 'fixed',
          delay: 5000,
        },

        removeOnComplete: true,

        removeOnFail: false,
      },
    );

    return {
      success: true,

      investmentId,

      status: InvestmentStatus.PROCESSING,

      txHash: normalizedHash,

      message:
        'Transaction submitted. Remzik is verifying the blockchain transaction.',
    };
  }

  // =========================================================
  // BLOCKCHAIN VERIFICATION
  // =========================================================

  async verifyOnChainInvestment(investmentId: string, txHash: string) {
    const investment = await this.investmentRepo.findOne({
      where: {
        id: investmentId,
      },
      relations: ['asset', 'investor', 'investor.user'],
    });

    if (!investment) {
      throw new NotFoundException('Investment not found.');
    }

    // ------------------------------------------------------
    // IDEMPOTENCY
    // ------------------------------------------------------

    if (investment.status === InvestmentStatus.CONFIRMED) {
      return {
        success: true,
        investmentId,
        status: InvestmentStatus.CONFIRMED,
        txHash: investment.txHash,
      };
    }

    if (investment.status === InvestmentStatus.FAILED) {
      return {
        success: false,
        investmentId,
        status: InvestmentStatus.FAILED,
      };
    }

    if (
      !investment.txHash ||
      investment.txHash.toLowerCase() !== txHash.toLowerCase()
    ) {
      throw new ConflictException(
        'Transaction hash does not match the investment record.',
      );
    }

    // ------------------------------------------------------
    // EXPECTED SNAPSHOT
    // ------------------------------------------------------

    const expectedWallet = investment.expectedWalletAddress;

    const expectedVault = investment.expectedVaultAddress;

    const expectedCalldata = investment.expectedCalldata;

    const expectedStablecoin = investment.expectedStablecoinAddress;

    const expectedStablecoinAmount = investment.expectedStablecoinAmount;

    const expectedTokenAmount = investment.expectedTokenAmount;

    const expectedTokenAddress =
      investment.expectedTokenAddress || investment.asset?.tokenAddress;

    if (!expectedWallet || !ethers.isAddress(expectedWallet)) {
      return this.failVerification(
        investmentId,
        'Investment wallet intent is invalid.',
      );
    }

    if (!expectedVault || !ethers.isAddress(expectedVault)) {
      return this.failVerification(
        investmentId,
        'Investment vault intent is invalid.',
      );
    }

    if (!expectedCalldata) {
      return this.failVerification(
        investmentId,
        'Investment calldata snapshot is missing.',
      );
    }

    if (!expectedStablecoin || !ethers.isAddress(expectedStablecoin)) {
      return this.failVerification(
        investmentId,
        'Investment stablecoin snapshot is invalid.',
      );
    }

    if (!expectedStablecoinAmount) {
      return this.failVerification(
        investmentId,
        'Investment stablecoin amount snapshot is missing.',
      );
    }

    if (!expectedTokenAddress || !ethers.isAddress(expectedTokenAddress)) {
      return this.failVerification(
        investmentId,
        'Investment token address snapshot is invalid.',
      );
    }

    if (!expectedTokenAmount) {
      return this.failVerification(
        investmentId,
        'Investment token amount snapshot is missing.',
      );
    }

    const tx = await this.provider.getTransaction(txHash);

    if (!tx) {
      throw new Error('TRANSACTION_NOT_PROPAGATED');
    }

    // ------------------------------------------------------
    // CHAIN ID
    // ------------------------------------------------------

    const expectedChainId = BigInt(String(investment.expectedChainId));

    const network = await this.provider.getNetwork();

    if (network.chainId !== expectedChainId) {
      throw new InternalServerErrorException(
        'Blockchain RPC is connected to the wrong network.',
      );
    }

    // ------------------------------------------------------
    // SENDER & DESTINATION & CALLDATA CHECKS
    // ------------------------------------------------------

    if (!tx.from || tx.from.toLowerCase() !== expectedWallet.toLowerCase()) {
      return this.failVerification(
        investmentId,
        'Transaction sender does not match the investment wallet.',
      );
    }

    if (!tx.to || tx.to.toLowerCase() !== expectedVault.toLowerCase()) {
      return this.failVerification(
        investmentId,
        'Transaction destination does not match the investment TreasuryVault.',
      );
    }

    if (!tx.data || tx.data.toLowerCase() !== expectedCalldata.toLowerCase()) {
      return this.failVerification(
        investmentId,
        'Transaction calldata does not match the investment intent.',
      );
    }

    if (tx.value !== 0n) {
      return this.failVerification(
        investmentId,
        'TreasuryVault deposit must not send native currency.',
      );
    }

    // ------------------------------------------------------
    // DECODE
    // ------------------------------------------------------

    let decoded: ethers.TransactionDescription | null = null;

    try {
      decoded = this.vaultInterface.parseTransaction({
        data: tx.data,
        value: tx.value,
      });
    } catch {
      return this.failVerification(
        investmentId,
        'Unable to decode TreasuryVault transaction.',
      );
    }

    if (!decoded || decoded.name !== 'deposit') {
      return this.failVerification(
        investmentId,
        'Transaction is not a valid TreasuryVault deposit.',
      );
    }

    const decodedStablecoin = String(decoded.args[0]);

    const decodedAmount = BigInt(decoded.args[1].toString());

    if (decodedStablecoin.toLowerCase() !== expectedStablecoin.toLowerCase()) {
      return this.failVerification(
        investmentId,
        'Stablecoin does not match the investment intent.',
      );
    }

    if (decodedAmount !== BigInt(expectedStablecoinAmount)) {
      return this.failVerification(
        investmentId,
        'Stablecoin amount does not match the investment intent.',
      );
    }

    // ------------------------------------------------------
    // RECEIPT & CONFIRMATIONS
    // ------------------------------------------------------

    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      throw new Error('TRANSACTION_NOT_MINED');
    }

    if (receipt.status !== 1) {
      return this.failVerification(
        investmentId,
        'On-chain transaction reverted.',
      );
    }

    const requiredConfirmations = Number(
      this.configService.get<string>('BLOCKCHAIN_CONFIRMATIONS') || '1',
    );

    const currentBlock = await this.provider.getBlockNumber();

    const confirmations = currentBlock - receipt.blockNumber + 1;

    if (confirmations < requiredConfirmations) {
      return {
        success: true,

        investmentId,

        status: InvestmentStatus.PROCESSING,

        txHash,

        confirmations,

        requiredConfirmations,

        message:
          'Transaction mined but waiting for required blockchain confirmations.',
      };
    }

    // ------------------------------------------------------
    // VERIFY VAULT EVENT
    // ------------------------------------------------------

    const vaultEvent = this.findStablecoinDepositedEvent(
      receipt,
      expectedVault,
    );

    if (!vaultEvent) {
      return this.failVerification(
        investmentId,
        'TreasuryVault StablecoinDeposited event was not found.',
      );
    }

    const eventInvestor = String(vaultEvent.args[0]);

    const eventStablecoin = String(vaultEvent.args[2]);

    const eventAmount = BigInt(vaultEvent.args[3].toString());

    if (eventInvestor.toLowerCase() !== expectedWallet.toLowerCase()) {
      return this.failVerification(
        investmentId,
        'TreasuryVault event investor does not match the investment wallet.',
      );
    }

    if (eventStablecoin.toLowerCase() !== expectedStablecoin.toLowerCase()) {
      return this.failVerification(
        investmentId,
        'TreasuryVault event stablecoin does not match the investment intent.',
      );
    }

    if (eventAmount !== BigInt(expectedStablecoinAmount)) {
      return this.failVerification(
        investmentId,
        'TreasuryVault event amount does not match the investment intent.',
      );
    }

    // ------------------------------------------------------
    // VERIFY ACTUAL STABLECOIN TRANSFER
    // ------------------------------------------------------

    const stablecoinTransfer = this.findERC20Transfer(
      receipt,
      expectedStablecoin,
      expectedWallet,
      expectedVault,
    );

    if (!stablecoinTransfer) {
      return this.failVerification(
        investmentId,
        'Actual stablecoin Transfer event was not found.',
      );
    }

    if (stablecoinTransfer.amount !== BigInt(expectedStablecoinAmount)) {
      return this.failVerification(
        investmentId,
        'Actual stablecoin transfer amount does not match the investment intent.',
      );
    }

    // ------------------------------------------------------
    // VERIFY ASSET TOKEN TRANSFER (WITH SAFE TOLERANCE)
    // ------------------------------------------------------

    const tokenTransfer = this.findERC20Transfer(
      receipt,
      expectedTokenAddress,
      expectedVault,
      expectedWallet,
    );

    if (!tokenTransfer) {
      return this.failVerification(
        investmentId,
        'Expected asset token transfer to investor was not found.',
      );
    }

    const expectedTokenBigInt = BigInt(expectedTokenAmount);
    const tokenDiff =
      tokenTransfer.amount > expectedTokenBigInt
        ? tokenTransfer.amount - expectedTokenBigInt
        : expectedTokenBigInt - tokenTransfer.amount;

    // Allow up to 1000 wei tolerance for on-chain division rounding adjustments
    const maxAllowedDifference = 1000n;

    if (tokenDiff > maxAllowedDifference) {
      this.logger.warn(
        `Token transfer mismatch for investment ${investmentId}: Expected ${expectedTokenBigInt.toString()}, Got ${tokenTransfer.amount.toString()} (Diff: ${tokenDiff.toString()})`,
      );

      return this.failVerification(
        investmentId,
        'Asset token transfer amount does not match the investment intent.',
      );
    }

    // ------------------------------------------------------
    // FINALIZE DATABASE
    // ------------------------------------------------------

    await this.finalizeVerifiedInvestment(
      investmentId,
      txHash,
      receipt.blockNumber,
      receipt.blockHash,
    );

    // ------------------------------------------------------
    // NOTIFICATION (Investor & Partner)
    // ------------------------------------------------------

    const reloaded = await this.investmentRepo.findOne({
      where: {
        id: investmentId,
      },
      relations: [
        'asset',
        'investor',
        'investor.user',
        'asset.partner',
        'asset.partner.user',
      ],
    });

    if (reloaded?.investor?.user?.id && reloaded.asset) {
      // 1. Investor notification
      await this.notificationOrchestrator.buildAndSave(
        reloaded.investor.user.id,
        'investment.created',
        {
          title: 'On-Chain Investment Confirmed!',

          message: `Your on-chain investment of SAR ${reloaded.amount} in "${reloaded.asset.title}" is confirmed.`,

          amount: reloaded.amount,

          asset: reloaded.asset.title,

          timestamp: new Date(),
        },
      );

      // 2. Partner notification
      if (reloaded.asset?.partner?.user?.id) {
        await this.notificationOrchestrator.buildAndSave(
          reloaded.asset.partner.user.id,
          'investment.partner.funded',
          {
            title: 'New On-Chain Investment Funded',
            message: `An on-chain investment of SAR ${reloaded.amount} was successfully verified for your asset "${reloaded.asset.title}".`,
            amount: reloaded.amount,
            asset: reloaded.asset.title,
            timestamp: new Date(),
          },
        );
      }
    }

    return {
      success: true,

      investmentId,

      status: InvestmentStatus.CONFIRMED,

      txHash,
    };
  }

  // =========================================================
  // FINALIZE
  // =========================================================

  private async finalizeVerifiedInvestment(
    investmentId: string,
    txHash: string,
    blockNumber: number,
    blockHash: string | null,
  ) {
    await this.dataSource.transaction(async (manager) => {
      // 1. Fetch and lock ONLY the investment entity first (no relations to prevent outer-join lock error)
      const investment = await manager.findOne(Investment, {
        where: {
          id: investmentId,
        },
        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!investment) {
        throw new NotFoundException('Investment not found.');
      }

      if (investment.status === InvestmentStatus.CONFIRMED) {
        return;
      }

      if (investment.status === InvestmentStatus.FAILED) {
        throw new ConflictException('Cannot finalize a failed investment.');
      }

      // 2. Fetch required relations safely inside the transaction after locking the main row
      const fullInvestment = await manager.findOne(Investment, {
        where: { id: investmentId },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (
        !fullInvestment ||
        !fullInvestment.asset ||
        !fullInvestment.investor
      ) {
        throw new NotFoundException('Investment relations are missing.');
      }

      /**
       * Lock the asset too.
       * This serializes: funded, investor count, ownership creation
       */
      const asset = await manager.findOne(Asset, {
        where: {
          id: fullInvestment.asset.id,
        },

        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!asset) {
        throw new NotFoundException('Investment asset not found.');
      }

      // ----------------------------------------------------
      // UNIQUE INVESTOR COUNT
      // ----------------------------------------------------

      const existingOwnership = await manager.findOne(Ownership, {
        where: {
          investorId: fullInvestment.investor.id,

          assetId: asset.id,
        },
      });

      // ----------------------------------------------------
      // FUNDING
      // ----------------------------------------------------

      asset.funded = Number(asset.funded || 0) + Number(fullInvestment.amount);

      if (!existingOwnership) {
        asset.investors = Number(asset.investors || 0) + 1;
      }

      await manager.save(Asset, asset);

      // ----------------------------------------------------
      // OWNERSHIP
      // ----------------------------------------------------

      await this.ownershipService.addShares(
        fullInvestment.investor,
        asset,
        Number(fullInvestment.units),
        manager,
      );

      // ----------------------------------------------------
      // FINAL STATE
      // ----------------------------------------------------

      investment.status = InvestmentStatus.CONFIRMED;

      investment.txHash = txHash;

      /**
       * These fields should exist on Investment.
       */
      (investment as any).blockNumber = blockNumber;

      (investment as any).blockHash = blockHash;

      (investment as any).confirmedAt = new Date();

      await manager.save(Investment, investment);
    });
  }

  // =========================================================
  // FAILURE
  // =========================================================

  private async failVerification(investmentId: string, reason: string) {
    await this.handleInvestmentFailure(investmentId, reason);

    return {
      success: false,

      investmentId,

      status: InvestmentStatus.FAILED,

      reason,
    };
  }

  async handleInvestmentFailure(
    investmentId: string,
    reason: string,
  ): Promise<void> {
    let investorUserId: string | null = null;
    let assetTitle: string | null = null;

    await this.investmentRepo.manager.transaction(async (manager) => {
      // 1. Fetch ONLY the investment with lock (NO relations to avoid Postgres join error)
      const investment = await manager.findOne(Investment, {
        where: {
          id: investmentId,
        },
        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!investment) {
        return;
      }

      if (investment.status === InvestmentStatus.CONFIRMED) {
        return;
      }

      if (investment.status === InvestmentStatus.FAILED) {
        return;
      }

      // 2. Fetch relations separately in a non-locked query if needed
      const fullInvestment = await manager.findOne(Investment, {
        where: { id: investmentId },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (fullInvestment?.investor?.user?.id) {
        investorUserId = fullInvestment.investor.user.id;
        assetTitle = fullInvestment.asset?.title || 'Property Asset';
      }

      // ----------------------------------------------------
      // RELEASE RESERVED SHARES
      // ----------------------------------------------------

      if (fullInvestment?.asset?.id) {
        const token = await manager
          .getRepository(AssetToken)
          .createQueryBuilder('token')
          .setLock('pessimistic_write')
          .where('token.assetId = :assetId', {
            assetId: fullInvestment.asset.id,
          })
          .getOne();

        if (token) {
          token.availableShares =
            Number(token.availableShares) + Number(investment.units);

          await manager.save(AssetToken, token);
        }
      }

      investment.status = InvestmentStatus.FAILED;
      (investment as any).failureReason = reason;
      (investment as any).failedAt = new Date();

      await manager.save(Investment, investment);

      this.logger.warn(`Investment ${investmentId} failed: ${reason}`);
    });

    // 🛡️ NOTIFICATION: Inform investor about investment failure / reversion
    if (investorUserId) {
      try {
        await this.notificationOrchestrator.buildAndSave(
          investorUserId,
          'investment.failed',
          {
            title: 'Investment Failed',
            message: `Your investment in "${assetTitle}" could not be completed. Reason: ${reason}`,
            reason,
            timestamp: new Date(),
          },
        );
      } catch (err) {
        this.logger.error(`Failed to dispatch failure notification: ${err}`);
      }
    }
  }

  // =========================================================
  // ADMIN CONFIRM
  // =========================================================

  async confirmInvestment(id: string): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: {
        id,
      },
    });

    if (!investment) {
      throw new NotFoundException(`Investment with ID ${id} not found`);
    }

    /**
     * CRITICAL:
     * Admin must NEVER confirm an ON_CHAIN investment manually.
     */
    if ((investment as any).expectedCalldata) {
      throw new BadRequestException(
        'On-chain investments cannot be manually confirmed by an administrator.',
      );
    }

    if (investment.status === InvestmentStatus.CONFIRMED) {
      return investment;
    }

    await this.investmentQueue.add('process-investment', {
      investmentId: id,
    });

    return investment;
  }

  // =========================================================
  // MY INVESTMENTS
  // =========================================================

  async getMyInvestments(userId: string): Promise<any[]> {
    const investments = await this.investmentRepo.find({
      where: {
        investor: {
          user: {
            id: userId,
          },
        },
      },

      relations: ['asset', 'investor', 'investor.user'],

      order: {
        createdAt: 'DESC',
      },
    });

    return Promise.all(
      investments.map(async (inv) => {
        const activeDist =
          inv.asset?.id && inv.investor?.id
            ? await this.distributionRepo.findOne({
                where: {
                  asset: {
                    id: inv.asset.id,
                  },

                  investor: {
                    id: inv.investor.id,
                  },
                },

                order: {
                  createdAt: 'DESC',
                },
              })
            : null;

        let merkleProof: any[] = [];

        if (Array.isArray(activeDist?.merkleProof)) {
          merkleProof = activeDist.merkleProof;
        } else if (typeof activeDist?.merkleProof === 'string') {
          try {
            merkleProof = JSON.parse(activeDist.merkleProof);
          } catch {
            merkleProof = [];
          }
        }

        return {
          ...inv,

          assetTitle: inv.asset?.title,

          amountInvested: inv.amount,

          roi: (inv.asset as any)?.targetRoi || 12.5,

          image: (inv.asset as any)?.imageUrl,

          distributionMode:
            activeDist?.distributionMode ||
            (inv.investor as any)?.distributionMode ||
            'ON_CHAIN',

          batchId: activeDist?.batchId || null,

          status: inv.status,

          merkleProof,

          distribution: activeDist
            ? {
                batchId: activeDist.batchId || null,

                distributionMode: activeDist.distributionMode || 'ON_CHAIN',

                merkleProof,

                status: activeDist.status,
              }
            : undefined,
        };
      }),
    );
  }

  // =========================================================
  // USER INVESTMENTS
  // =========================================================

  async getByUser(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: {
        investor: {
          user: {
            id: userId,
          },
        },
      },

      relations: ['investor', 'asset'],
    });
  }

  // =========================================================
  // LIVE STATUS
  // =========================================================

  async getLiveStatus(id: string, userId: string) {
    const investment = await this.investmentRepo.findOne({
      where: {
        id,
      },

      relations: ['investor', 'investor.user'],
    });

    if (!investment) {
      throw new NotFoundException(`Investment with ID ${id} not found`);
    }

    if (investment.investor?.user?.id !== userId) {
      throw new ForbiddenException(
        'You are not authorized to view this investment.',
      );
    }

    return {
      id: investment.id,

      status: investment.status,

      txHash: investment.txHash || null,

      failureReason: (investment as any).failureReason || null,

      blockNumber: (investment as any).blockNumber || null,

      confirmedAt: (investment as any).confirmedAt || null,
    };
  }

  // =========================================================
  // STATISTICS
  // =========================================================

  async getTotalByAsset(assetId: string): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('i')
      .select('SUM(i.amount)', 't')
      .where('i.assetId = :assetId', {
        assetId,
      })
      .andWhere('i.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    return Number(result?.t) || 0;
  }

  async getTotalInvested(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('i')
      .select('SUM(CAST(i.amount AS FLOAT))', 't')
      .where('i.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    return result?.t ? parseFloat(result.t) : 0;
  }

  async countUniqueInvestors(): Promise<number> {
    const result = await this.investmentRepo
      .createQueryBuilder('i')
      .select('COUNT(DISTINCT(i.investorId))', 'c')
      .where('i.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    return parseInt(result?.c || '0', 10);
  }

  // =========================================================
  // LEGACY SERVER-SIDE BLOCKCHAIN FLOW
  // =========================================================
  //
  // KEEP ONLY FOR OLD INTERNAL/OFF-CHAIN WORKFLOWS.
  //
  // NEVER call this from investor ON_CHAIN flow.
  // =========================================================

  async executeBlockchainTransfer(investmentId: string): Promise<string> {
    const investment = await this.investmentRepo.findOne({
      where: {
        id: investmentId,
      },
      relations: ['asset', 'investor', 'investor.user'],
    });

    if (!investment) {
      throw new NotFoundException('Investment record not found');
    }

    if (
      !investment.asset?.tokenAddress ||
      !investment.asset?.treasuryAddress ||
      !investment.investor?.user?.walletAddress
    ) {
      throw new InternalServerErrorException(
        'Missing blockchain configuration.',
      );
    }

    const assetToken = await this.assetTokenRepo.findOne({
      where: {
        asset: {
          id: investment.asset.id,
        },
      },
    });

    // 🛡 Fallback to standard 18 decimals if missing or unconfigured
    const rawDecimals = Number((assetToken as any)?.decimals);
    const decimals = Number.isInteger(rawDecimals) ? rawDecimals : 18;

    if (!Number.isInteger(rawDecimals)) {
      this.logger.warn(
        `Asset token decimals not explicitly configured for asset ${investment.asset.id}. Defaulting to 18.`,
      );
    }

    const receipt: any = await this.blockchainService.transferFromTreasuryVault(
      investment.asset.tokenAddress,
      investment.asset.treasuryAddress,
      investment.investor.user.walletAddress,
      investment.units.toString(),
      decimals,
    );

    if (!receipt) {
      throw new InternalServerErrorException(
        'Blockchain transaction receipt not found.',
      );
    }

    const txHash = receipt.hash || receipt.transactionHash;

    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new InternalServerErrorException(
        `Invalid transaction hash: ${txHash}`,
      );
    }

    return txHash;
  }
  // =========================================================
  // HELPERS
  // =========================================================

  private calculateShares(amount: number, sharePrice: number): number {
    const raw = amount / sharePrice;

    const shares = Math.round(raw * 10000) / 10000;

    if (!Number.isFinite(shares) || shares <= 0) {
      throw new BadRequestException('Calculated investment units are invalid.');
    }

    return shares;
  }

  private getBlockchainChainId(): number {
    const configured = this.configService.get<string>('BLOCKCHAIN_CHAIN_ID');

    const chainId = Number(configured || '31337');

    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new InternalServerErrorException('Invalid BLOCKCHAIN_CHAIN_ID.');
    }

    return chainId;
  }

  // =========================================================
  // VAULT EVENT
  // =========================================================

  private findStablecoinDepositedEvent(
    receipt: ethers.TransactionReceipt,
    vaultAddress: string,
  ): ethers.LogDescription | null {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== vaultAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = this.vaultInterface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed?.name === 'StablecoinDeposited') {
          return parsed;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // =========================================================
  // ERC20 TRANSFER
  // =========================================================

  private findERC20Transfer(
    receipt: ethers.TransactionReceipt,
    tokenAddress: string,
    fromAddress: string,
    toAddress: string,
  ): {
    amount: bigint;
  } | null {
    const matches: {
      amount: bigint;
    }[] = [];

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = this.erc20Interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed?.name !== 'Transfer') {
          continue;
        }

        const from = String(parsed.args[0]);

        const to = String(parsed.args[1]);

        const amount = BigInt(parsed.args[2].toString());

        if (
          from.toLowerCase() === fromAddress.toLowerCase() &&
          to.toLowerCase() === toAddress.toLowerCase() &&
          amount > 0n
        ) {
          matches.push({
            amount,
          });
        }
      } catch {
        continue;
      }
    }

    /**
     * Multiple matching transfers make the transaction ambiguous.
     */
    if (matches.length !== 1) {
      return null;
    }

    return matches[0];
  }
}
