import { Injectable, Logger } from '@nestjs/common';
import { Interface, LogDescription } from 'ethers';
import { IdentityEventHandler } from './handlers/identity.handler';
import { AssetEventHandler } from './handlers/asset.handler';
import { InvestmentHandler } from './handlers/investment.handler';
import { GovernanceHandler } from './handlers/governance.handler';
import { MarketplaceHandler } from './handlers/marketplace.handler';
import { YieldHandler } from './handlers/yield.handler';

// 1. Identity Registry ABI fragments (Matched exact Solidity signatures with authorizedBy)
const IDENTITY_REGISTRY_ABI = [
  'event IdentityUpdated(address indexed investor, bool isVerified, address indexed authorizedBy)',
  'event IdentityFreezeToggled(address indexed investor, bool isFrozen, address indexed authorizedBy)',
];

// 2. Asset Factory ABI fragments (Matched Solidity parameter order: tokenAddress, treasuryAddress, governanceAddress, name)
const ASSET_FACTORY_ABI = [
  'event AssetPodDeployed(address indexed tokenAddress, address indexed treasuryAddress, address indexed governanceAddress, string name)',
];

// 3. Treasury Vault / Token ABI fragments
const TREASURY_OR_TOKEN_ABI = [
  'event TokensReleased(address indexed token, address indexed recipient, uint256 amount)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// 4. Property Governance ABI fragments (Matched exact Solidity signatures)
const PROPERTY_GOVERNANCE_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, string description, uint256 deadline)',
  'event Voted(uint256 indexed proposalId, address voter, bool support, uint256 weight)',
  'event ProposalExecuted(uint256 indexed proposalId, string action)',
  'event LiquidationActivated(address indexed tokenAddress)',
];

// 5. Marketplace ABI fragments
const MARKETPLACE_ABI = [
  'event ListingCreated(string indexed listingId, address indexed seller, address indexed token, uint256 amount)',
  'event ListingCancelled(string indexed listingId)',
  'event TradeExecuted(string indexed listingId, address indexed seller, address indexed buyer, uint256 price)',
  'event OnChainTradeExecuted(string indexed listingId, address indexed buyer, uint256 unitsBought, uint256 totalCost)',
];

// 6. Yield Notary ABI fragments (Updated with Merkle root and Claim support)
const YIELD_NOTARY_ABI = [
  'event YieldRecorded(bytes32 indexed batchId, address indexed propertyAddress, uint256 totalNetYield)',
  'event YieldRecordedWithMerkle(bytes32 indexed batchId, address indexed propertyAddress, bytes32 indexed merkleRoot, uint256 totalOnChainAmount)',
  'event YieldClaimed(bytes32 indexed batchId, address indexed account, uint256 amount, uint256 timestamp)',
];

// 7. Recovery Manager ABI fragments (Added missing event)
const RECOVERY_MANAGER_ABI = [
  'event WalletRecovered(address indexed oldWallet, address indexed newWallet, address indexed tokenAddress, uint256 amount, uint256 timestamp)',
];

// 8. Price Oracle ABI fragments (Added missing event)
const PRICE_ORACLE_ABI = [
  'event BandUpdated(address indexed token, uint256 lowerBound, uint256 upperBound, uint256 timestamp)',
];

@Injectable()
export class IndexerRouter {
  private readonly logger = new Logger(IndexerRouter.name);

  private readonly identityInterface = new Interface(IDENTITY_REGISTRY_ABI);
  private readonly assetFactoryInterface = new Interface(ASSET_FACTORY_ABI);
  private readonly treasuryOrTokenInterface = new Interface(
    TREASURY_OR_TOKEN_ABI,
  );
  private readonly governanceInterface = new Interface(PROPERTY_GOVERNANCE_ABI);
  private readonly marketplaceInterface = new Interface(MARKETPLACE_ABI);
  private readonly yieldNotaryInterface = new Interface(YIELD_NOTARY_ABI);
  private readonly recoveryManagerInterface = new Interface(
    RECOVERY_MANAGER_ABI,
  );
  private readonly priceOracleInterface = new Interface(PRICE_ORACLE_ABI);

  // Master list of interfaces for universal fallback matching
  private readonly allInterfaces = [
    { name: 'IdentityRegistry', iface: this.identityInterface },
    { name: 'AssetFactory', iface: this.assetFactoryInterface },
    { name: 'TreasuryOrToken', iface: this.treasuryOrTokenInterface },
    { name: 'PropertyGovernance', iface: this.governanceInterface },
    { name: 'Marketplace', iface: this.marketplaceInterface },
    { name: 'YieldNotary', iface: this.yieldNotaryInterface },
    { name: 'RecoveryManager', iface: this.recoveryManagerInterface },
    { name: 'PriceOracle', iface: this.priceOracleInterface },
  ];

  constructor(
    private readonly identityHandler: IdentityEventHandler,
    private readonly assetHandler: AssetEventHandler,
    private readonly investmentHandler: InvestmentHandler,
    private readonly governanceHandler: GovernanceHandler,
    private readonly marketplaceHandler: MarketplaceHandler,
    private readonly yieldHandler: YieldHandler,
  ) {}

  async routeEvent(
    contractAddress: string,
    topics: string[],
    data: string,
    txHash: string,
    blockNumber: number = 0,
  ): Promise<string> {
    try {
      // 1. Identity Registry
      const identityParsed = this.parseLog(
        this.identityInterface,
        topics,
        data,
      );
      if (identityParsed) {
        switch (identityParsed.name) {
          case 'IdentityUpdated':
            await this.identityHandler.handleIdentityUpdated(
              identityParsed.args['investor'],
              identityParsed.args['isVerified'],
              txHash,
            );
            return 'IdentityUpdated';
          case 'IdentityFreezeToggled':
            await this.identityHandler.handleIdentityFreezeToggled(
              identityParsed.args['investor'],
              identityParsed.args['isFrozen'],
              txHash,
            );
            return 'IdentityFreezeToggled';
        }
      }

      // 2. Asset Factory
      const assetParsed = this.parseLog(
        this.assetFactoryInterface,
        topics,
        data,
      );
      if (assetParsed) {
        switch (assetParsed.name) {
          case 'AssetPodDeployed':
            await this.assetHandler.handleAssetPodDeployed(
              assetParsed.args['tokenAddress'],
              assetParsed.args['treasuryAddress'],
              assetParsed.args['governanceAddress'],
              assetParsed.args['name'],
              txHash,
            );
            return 'AssetPodDeployed';
        }
      }

      // 3. Treasury / Token
      const treasuryParsed = this.parseLog(
        this.treasuryOrTokenInterface,
        topics,
        data,
      );
      if (treasuryParsed) {
        switch (treasuryParsed.name) {
          case 'TokensReleased':
            await this.investmentHandler.handleEvent({
              tokenAddress: treasuryParsed.args['token'],
              treasuryAddress: contractAddress,
              recipientWallet: treasuryParsed.args['recipient'],
              amountUnits: treasuryParsed.args['amount'].toString(),
              txHash,
              blockNumber,
            });
            return 'TokensReleased';
          case 'Transfer':
            return 'Transfer';
        }
      }

      // 4. Property Governance
      const governanceParsed = this.parseLog(
        this.governanceInterface,
        topics,
        data,
      );
      if (governanceParsed) {
        switch (governanceParsed.name) {
          case 'ProposalCreated':
            await this.governanceHandler.handleProposalCreated({
              proposalId: governanceParsed.args['proposalId'].toString(),
              assetAddress: contractAddress,
              description: governanceParsed.args['description'],
              txHash,
              blockNumber,
            });
            return 'ProposalCreated';
          case 'Voted':
            await this.governanceHandler.handleVoted({
              proposalId: governanceParsed.args['proposalId'].toString(),
              voterWallet: governanceParsed.args['voter'],
              support: governanceParsed.args['support'],
              weight: governanceParsed.args['weight'].toString(),
              txHash,
            });
            return 'Voted';
          case 'ProposalExecuted':
            return 'ProposalExecuted';
          case 'LiquidationActivated':
            return 'LiquidationActivated';
        }
      }

      // 5. Marketplace
      const marketplaceParsed = this.parseLog(
        this.marketplaceInterface,
        topics,
        data,
      );
      if (marketplaceParsed) {
        switch (marketplaceParsed.name) {
          case 'ListingCreated':
            await this.marketplaceHandler.handleListingCreated(
              marketplaceParsed.args['listingId'],
              marketplaceParsed.args['seller'],
              marketplaceParsed.args['token'],
              marketplaceParsed.args['amount'],
              txHash,
            );
            return 'ListingCreated';
          case 'ListingCancelled':
            await this.marketplaceHandler.handleListingCancelled(
              marketplaceParsed.args['listingId'],
              txHash,
            );
            return 'ListingCancelled';
          case 'TradeExecuted':
            await this.marketplaceHandler.handleTradeExecuted(
              marketplaceParsed.args['listingId'],
              marketplaceParsed.args['seller'],
              marketplaceParsed.args['buyer'],
              marketplaceParsed.args['price'],
              txHash,
            );
            return 'TradeExecuted';
          case 'OnChainTradeExecuted':
            await this.marketplaceHandler.handleOnChainTradeExecuted(
              marketplaceParsed.args['listingId'],
              marketplaceParsed.args['buyer'],
              marketplaceParsed.args['unitsBought'],
              marketplaceParsed.args['totalCost'],
              txHash,
            );
            return 'OnChainTradeExecuted';
        }
      }

      // 6. Yield Notary
      const yieldParsed = this.parseLog(
        this.yieldNotaryInterface,
        topics,
        data,
      );
      if (yieldParsed) {
        switch (yieldParsed.name) {
          case 'YieldRecorded':
            await this.yieldHandler.handleYieldRecorded({
              batchId: yieldParsed.args['batchId'],
              propertyAddress: yieldParsed.args['propertyAddress'],
              totalNetYield: yieldParsed.args['totalNetYield'].toString(),
              txHash,
            });
            return 'YieldRecorded';
          case 'YieldRecordedWithMerkle':
            await this.yieldHandler.handleYieldBatchMerkleRecorded({
              batchId: yieldParsed.args['batchId'],
              propertyAddress: yieldParsed.args['propertyAddress'],
              merkleRoot: yieldParsed.args['merkleRoot'],
              totalAmount: yieldParsed.args['totalOnChainAmount'].toString(),
              txHash,
            });
            return 'YieldRecordedWithMerkle';
          case 'YieldClaimed':
            await this.yieldHandler.handleYieldClaimed({
              batchId: yieldParsed.args['batchId'],
              account: yieldParsed.args['account'],
              amount: yieldParsed.args['amount'].toString(),
              txHash,
            });
            return 'YieldClaimed';
        }
      }

      // 7. Recovery Manager
      const recoveryParsed = this.parseLog(
        this.recoveryManagerInterface,
        topics,
        data,
      );
      if (recoveryParsed) {
        switch (recoveryParsed.name) {
          case 'WalletRecovered':
            return 'WalletRecovered';
        }
      }

      // 8. Price Oracle
      const oracleParsed = this.parseLog(
        this.priceOracleInterface,
        topics,
        data,
      );
      if (oracleParsed) {
        switch (oracleParsed.name) {
          case 'BandUpdated':
            return 'BandUpdated';
        }
      }

      // 🛡️ UNIVERSAL FALLBACK: Scan all known interfaces
      for (const item of this.allInterfaces) {
        const fallbackParsed = this.parseLog(item.iface, topics, data);
        if (fallbackParsed) {
          return fallbackParsed.name;
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to route event for tx ${txHash}: ${err.message}`,
      );
    }

    return 'SMART_CONTRACT_EVENT';
  }

  private parseLog(
    contractInterface: Interface,
    topics: string[],
    data: string,
  ): LogDescription | null {
    try {
      return contractInterface.parseLog({ topics: [...topics], data });
    } catch {
      return null;
    }
  }
}
