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
  private factoryAddr: string;
  private factoryInterface: ethers.Interface;

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL')!;
    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY')!;
    const registryAddr = this.configService.get<string>(
      'COMPLIANCE_CONTRACT_ADDRESS',
    )!;
    this.factoryAddr = this.configService.get<string>(
      'ASSET_FACTORY_CONTRACT_ADDRESS',
    )!;

    // No-ENS zone configuration
    const network: ethers.Networkish = {
      name: 'local-hardhat',
      chainId: 31337,
      ensAddress: undefined,
    };

    const provider = new ethers.JsonRpcProvider(rpcUrl, network, {
      staticNetwork: true,
    });

    this.wallet = new ethers.Wallet(privateKey, provider);

    this.registryContract = new ethers.Contract(
      registryAddr,
      RemzikIdentityRegistryABI.abi,
      this.wallet,
    );

    this.factoryInterface = new ethers.Interface(AssetFactoryABI.abi);
  }

  async deployAssetContract(
    name: string,
    symbol: string,
    supply: bigint,
    metadataHash: string,
    treasuryAddress: string,
  ): Promise<string> {
    try {
      this.logger.log(`Deploying token contract: ${name} (${symbol})`);

      // 1. Verify contract exists at address
      const code = await this.wallet.provider!.getCode(this.factoryAddr);
      if (code === '0x') {
        throw new Error(
          `No contract found at address ${this.factoryAddr}. Check your .env.`,
        );
      }

      const data = this.factoryInterface.encodeFunctionData('deployAsset', [
        name,
        symbol,
        supply,
        metadataHash,
        treasuryAddress,
      ]);

      const tx = await this.wallet.sendTransaction({
        to: this.factoryAddr,
        data: data,
        gasLimit: 5000000n,
      });

      const receipt = await tx.wait(1);

      // 2. Validate receipt status
      if (receipt?.status === 0) {
        throw new Error(
          'Transaction reverted by EVM. Check Solidity require/revert conditions.',
        );
      }

      // 3. Robust Event Retrieval
      const eventFragment =
        this.factoryInterface.getEvent('AssetTokenDeployed');
      const log = receipt?.logs.find(
        (l) => l.topics[0] === eventFragment?.topicHash,
      );

      if (!log) {
        this.logger.error(`Receipt logs: ${JSON.stringify(receipt?.logs)}`);
        throw new Error(
          'Transaction succeeded but AssetTokenDeployed event was not found. ABI may be mismatched.',
        );
      }

      const parsed = this.factoryInterface.parseLog(log);
      return parsed?.args.tokenAddress;
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

  /**
   * Executes a token transfer from the Treasury/Vault to an Investor.
   * This is the heart of the "Mirror" process.
   */
  async transferFromVault(
    tokenAddress: string,
    to: string,
    amount: number,
    decimals: number = 18, // Ensure this matches your RemzikAssetToken
  ): Promise<string> {
    try {
      // 1. Initialize the Token Contract Interface
      const erc20Abi = [
        'function transfer(address to, uint256 amount) external returns (bool)',
        'function decimals() view returns (uint8)',
      ];
      const tokenContract = new ethers.Contract(
        tokenAddress,
        erc20Abi,
        this.wallet,
      );

      // 2. Convert human-readable amount to BigInt
      const amountBigInt = ethers.parseUnits(amount.toString(), decimals);

      // 3. Execute Transfer
      this.logger.log(`Transferring ${amount} units from Treasury to ${to}`);
      const tx = await tokenContract.transfer(to, amountBigInt);

      // 4. Wait for confirmation
      const receipt = await tx.wait(1);

      if (receipt?.status === 0) {
        throw new Error(
          'Transaction reverted by the EVM (likely compliance check failure)',
        );
      }

      return receipt!.hash;
    } catch (error: any) {
      this.logger.error(`Blockchain Transfer Failed: ${error.message}`);
      throw error; // Re-throw to be handled by the BullMQ worker for retries
    }
  }
}
