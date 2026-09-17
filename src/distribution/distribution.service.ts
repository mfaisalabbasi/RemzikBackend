import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, MoreThan } from 'typeorm';
import { Distribution, DistributionMode } from './distribution.entity';
import { Ownership } from '../ownership/ownership.entity';
import { WalletService } from 'src/wallet/wallet.service';
import { LedgerSource } from 'src/ledger/enums/ledger-source.enum';
import { PayoutStatus } from './enums/payout-status.enum';
import { Investment } from 'src/investment/investment.entity';
import { AssetIncome } from 'src/asset/asset-income.entity';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { ethers } from 'ethers';
import { InvestorProfile } from 'src/investor/investor.entity';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);
  private readonly PLATFORM_FEE_PERCENT = 0.01;
  private readonly ADMIN_WALLET_USER_ID = 'SYSTEM_REVENUE_ACCOUNT';
  private readonly TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 6);

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(Distribution)
    private readonly distributionRepo: Repository<Distribution>,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
    private readonly blockchainService: BlockchainService,
  ) {}

  // OpenZeppelin standard tree generator using structured leaf values [address, uint256]
  private generateMerkleTreeFromEntries(
    entries: Array<{ address: string; weiAmount: string }>,
  ): {
    root: string;
    proofs: string[][];
  } {
    if (entries.length === 0) return { root: ethers.ZeroHash, proofs: [] };

    const values = entries.map((e) => [e.address, e.weiAmount]);
    const tree = StandardMerkleTree.of(values, ['address', 'uint256']);

    const proofs = entries.map((_, i) => tree.getProof(i));

    return { root: tree.root, proofs };
  }

  async triggerDistributionFromIncome(incomeId: string, partnerUserId: string) {
    if (!partnerUserId) {
      throw new BadRequestException(
        'Partner authentication identity context is missing.',
      );
    }

    return await this.dataSource.transaction(async (manager) => {
      const income = await manager
        .getRepository(AssetIncome)
        .createQueryBuilder('income')
        .setLock('pessimistic_write')
        .where('income.id = :incomeId', { incomeId })
        .getOne();

      if (!income) {
        throw new NotFoundException('Income record not found.');
      }

      if (income.isDistributed) {
        throw new BadRequestException(
          'This revenue has already been distributed to investors.',
        );
      }

      const fullAssetContext = await manager.findOne(AssetIncome, {
        where: { id: incomeId },
        relations: ['asset', 'asset.partner', 'asset.partner.user'],
      });

      if (
        !fullAssetContext ||
        fullAssetContext.asset?.partner?.user?.id !== partnerUserId
      ) {
        throw new BadRequestException(
          'Unauthorized access: Asset partner profile ownership mismatch.',
        );
      }

      income.isDistributed = true;
      await manager.save(income);

      return this.triggerYieldDistribution(
        partnerUserId,
        fullAssetContext.asset.id,
        Number(income.netAmount),
        manager,
      );
    });
  }

  async triggerYieldDistribution(
    partnerUserId: string,
    assetId: string,
    totalAmount: number,
    existingManager?: EntityManager,
  ) {
    const work = async (manager: EntityManager) => {
      const partnerBalance =
        await this.walletService.getAvailableBalance(partnerUserId);
      if (partnerBalance < totalAmount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Needed: SAR ${totalAmount}, Available: SAR ${partnerBalance}.`,
        );
      }

      const currentHolders = await manager.find(Ownership, {
        where: { assetId: assetId, units: MoreThan(0) },
        relations: ['asset', 'investor', 'investor.user'],
      });

      if (currentHolders.length === 0) {
        throw new BadRequestException(
          'No eligible investors found for this asset.',
        );
      }

      const totalUnitsCirculating = currentHolders.reduce(
        (sum, h) => sum + Number(h.units),
        0,
      );

      const batchId = `BATCH-${Date.now()}-${assetId.substring(0, 4)}`;
      let allocatedGrossTotal = 0;

      for (let i = 0; i < currentHolders.length; i++) {
        const holder = currentHolders[i];
        const isLastInvestor = i === currentHolders.length - 1;

        let grossUserYield = 0;

        if (isLastInvestor) {
          const rawLastYield = totalAmount - allocatedGrossTotal;
          grossUserYield = Math.round(rawLastYield * 100) / 100;
        } else {
          const userShareOfUnits = Number(holder.units) / totalUnitsCirculating;
          grossUserYield =
            Math.round(totalAmount * userShareOfUnits * 100) / 100;
          allocatedGrossTotal += grossUserYield;
        }

        const preferredMode =
          holder.investor.distributionMode || DistributionMode.OFF_CHAIN;

        await manager.save(
          manager.create(Distribution, {
            asset: holder.asset,
            investor: holder.investor,
            amount: grossUserYield,
            period: new Date().toISOString(),
            status: PayoutStatus.PENDING,
            distributionMode: preferredMode,
            batchId: batchId,
          } as any),
        );
      }

      return {
        success: true,
        batchId,
        status: 'PENDING_ADMIN_APPROVAL',
        totalGrossAmount: totalAmount,
        investorCount: currentHolders.length,
      };
    };

    return existingManager
      ? work(existingManager)
      : await this.dataSource.transaction(work);
  }

  async approveDistributionBatch(batchId: string) {
    let merkleMetadata: {
      merkleRoot: string;
      totalOnChainAmount: number;
    } | null = null;
    let assetAddress: string;

    const cleanBatchId = batchId.trim();

    const result = await this.dataSource.transaction(async (manager) => {
      const pendingPayouts = await manager.find(Distribution, {
        where: { batchId: cleanBatchId, status: PayoutStatus.PENDING },
        relations: [
          'investor',
          'investor.user',
          'asset',
          'asset.partner',
          'asset.partner.user',
        ],
      });

      if (pendingPayouts.length === 0) {
        throw new NotFoundException('Batch not found or already processed.');
      }

      this.logger.debug(
        `[ApproveBatch] Found ${pendingPayouts.length} pending payouts for batch ${cleanBatchId}`,
      );

      const partnerUserId = pendingPayouts[0].asset.partner.user.id;
      const assetTitle = pendingPayouts[0].asset.title;
      assetAddress = pendingPayouts[0].asset.tokenAddress;

      const totalGrossAmount = pendingPayouts.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );

      const platformFee =
        Math.round(totalGrossAmount * this.PLATFORM_FEE_PERCENT * 100) / 100;

      await this.walletService.debitAvailable(
        partnerUserId,
        totalGrossAmount,
        manager,
      );
      await this.walletService.credit(
        partnerUserId,
        0,
        LedgerSource.DISTRIBUTION,
        `DEBIT: Yield Payout for ${assetTitle}`,
        manager,
      );

      if (platformFee > 0) {
        await this.walletService.credit(
          this.ADMIN_WALLET_USER_ID,
          platformFee,
          LedgerSource.DISTRIBUTION,
          `REVENUE: 1% Fee from ${assetTitle} Distribution`,
          manager,
        );
      }

      const totalNetToInvestors =
        Math.round((totalGrossAmount - platformFee) * 100) / 100;

      const offChainList = pendingPayouts.filter(
        (p) =>
          (p.investor?.distributionMode ?? p.distributionMode) ===
          DistributionMode.OFF_CHAIN,
      );
      const onChainList = pendingPayouts.filter(
        (p) =>
          (p.investor?.distributionMode ?? p.distributionMode) ===
          DistributionMode.ON_CHAIN,
      );

      let distributedNetTotal = 0;

      for (let i = 0; i < offChainList.length; i++) {
        const payout = offChainList[i];
        const isLastOverall =
          i === offChainList.length - 1 && onChainList.length === 0;

        let individualNetYield = 0;

        if (isLastOverall) {
          individualNetYield =
            Math.round((totalNetToInvestors - distributedNetTotal) * 100) / 100;
        } else {
          const rawNetYield =
            Number(payout.amount) * (1 - this.PLATFORM_FEE_PERCENT);
          individualNetYield = Math.round(rawNetYield * 100) / 100;
          distributedNetTotal += individualNetYield;
        }

        await this.walletService.creditEarned(
          payout.investor.user.id,
          individualNetYield,
          LedgerSource.DISTRIBUTION,
          `CREDIT: Yield from ${assetTitle} (Net of Platform Fee)`,
          manager,
        );

        payout.status = PayoutStatus.PAID;
        payout.amount = individualNetYield;
        await manager.save(payout);
      }

      let totalOnChainNetGross = 0;
      const onChainEntries: Array<{
        payout: (typeof onChainList)[0];
        address: string;
        weiAmount: string;
      }> = [];

      if (onChainList.length > 0) {
        for (let i = 0; i < onChainList.length; i++) {
          const payout = onChainList[i];
          const isLastOnChain =
            i === onChainList.length - 1 && offChainList.length === 0;

          let individualNetYield = 0;
          if (isLastOnChain) {
            individualNetYield =
              Math.round((totalNetToInvestors - distributedNetTotal) * 100) /
              100;
          } else {
            const rawNetYield =
              Number(payout.amount) * (1 - this.PLATFORM_FEE_PERCENT);
            individualNetYield = Math.round(rawNetYield * 100) / 100;
            distributedNetTotal += individualNetYield;
          }

          payout.amount = individualNetYield;
          totalOnChainNetGross += individualNetYield;

          const userWallet = payout.investor?.user?.walletAddress?.trim();
          if (!userWallet) {
            throw new BadRequestException(
              `Investor ${payout.investor?.id} selected ON_CHAIN distribution but has no linked wallet address.`,
            );
          }

          const normalizedAddress = ethers.getAddress(userWallet);
          const weiAmountString = ethers
            .parseUnits(individualNetYield.toFixed(2), this.TOKEN_DECIMALS)
            .toString();

          onChainEntries.push({
            payout,
            address: normalizedAddress,
            weiAmount: weiAmountString,
          });
        }

        // 🛡️ SORT DETERMINISTICALLY BY ADDRESS TO ENSURE STABLE MERKLE INDICES
        onChainEntries.sort((a, b) => a.address.localeCompare(b.address));

        const { root: merkleRoot, proofs } = this.generateMerkleTreeFromEntries(
          onChainEntries.map((e) => ({
            address: e.address,
            weiAmount: e.weiAmount,
          })),
        );

        for (let i = 0; i < onChainEntries.length; i++) {
          const entry = onChainEntries[i];
          const proofArray = proofs[i] || [];
          entry.payout.merkleProof = proofArray;
          entry.payout.status = 'READY' as PayoutStatus;
          entry.payout.distributionMode = DistributionMode.ON_CHAIN;

          // Updated to persist net amount to DB so proof generation matches perfectly
          await manager.query(
            `UPDATE distributions SET "merkleProof" = $1::jsonb, amount = $2, status = 'READY', "distributionMode" = 'ON_CHAIN' WHERE id = $3`,
            [JSON.stringify(proofArray), entry.payout.amount, entry.payout.id],
          );
        }

        merkleMetadata = {
          merkleRoot,
          totalOnChainAmount: totalOnChainNetGross,
        };
      }

      return {
        success: true,
        summary: {
          totalGross: totalGrossAmount,
          remzikRevenue: platformFee,
          netInvestorPayout: totalNetToInvestors,
          batchId: cleanBatchId,
          assetAddress: assetAddress,
          offChainCount: offChainList.length,
          onChainCount: onChainList.length,
          merkleRoot: merkleMetadata?.merkleRoot || null,
          totalOnChainAmount: merkleMetadata?.totalOnChainAmount || 0,
        },
      };
    });

    try {
      if (result.summary.merkleRoot) {
        const totalOnChainWei = ethers
          .parseUnits(
            result.summary.totalOnChainAmount.toFixed(2),
            this.TOKEN_DECIMALS,
          )
          .toString();

        this.logger.debug(
          `[Merkle Debug] Submitting root ${result.summary.merkleRoot} for batch ${cleanBatchId}`,
        );

        await this.blockchainService.recordYieldWithMerkleOnChain(
          result.summary.batchId,
          result.summary.assetAddress,
          result.summary.merkleRoot,
          totalOnChainWei,
        );
      } else {
        const netInvestorPayoutWei = ethers
          .parseUnits(
            result.summary.netInvestorPayout.toFixed(2),
            this.TOKEN_DECIMALS,
          )
          .toString();

        await this.blockchainService.recordYieldOnChain(
          result.summary.batchId,
          result.summary.assetAddress,
          netInvestorPayoutWei,
        );
      }
    } catch (error) {
      this.logger.error(
        `Web3 Notary failed for batch ${cleanBatchId}, will retry via queue:`,
        error,
      );
    }

    return result;
  }

  async getGlobalPendingBatches() {
    return this.dataSource.query(`
      SELECT 
        d."batchId", 
        a."title" as "assetTitle",
        d."period",
        COUNT(d.id)::int as "investorCount", 
        SUM(d.amount)::float as "totalAmount",
        MIN(d."createdAt") as "requestedAt"
      FROM distributions d
      JOIN assets a ON d."assetId" = a.id
      WHERE d.status::text IN ('PENDING', 'PENDING_CLAIM')
      GROUP BY d."batchId", a."title", d."period"
      ORDER BY "requestedAt" ASC
    `);
  }

  async rejectDistributionBatch(batchId: string, reason: string) {
    const cleanBatchId = batchId.trim();
    return await this.distributionRepo.delete({
      batchId: cleanBatchId,
      status: PayoutStatus.PENDING,
    });
  }

  async getUserMerkleProof(batchId: string, userId: string) {
    const cleanBatchId = batchId.trim();

    // Fetch the specific user's on-chain distribution record and pre-calculated proof directly from DB
    const rows = await this.dataSource.query(
      `SELECT d.id, d."batchId", d.amount, d."merkleProof", u."walletAddress", d.status
       FROM distributions d
       JOIN "investor_profiles" i ON d."investorId" = i.id
       JOIN "users" u ON i."userId" = u.id
       WHERE d."batchId" = $1 
         AND u.id = $2
         AND d."distributionMode" = 'ON_CHAIN'
       LIMIT 1`,
      [cleanBatchId, userId],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundException(
        'On-chain distribution record or wallet not found for user in this batch.',
      );
    }

    const record = rows[0];

    if (record.status === PayoutStatus.PAID) {
      throw new BadRequestException('This yield has already been claimed.');
    }

    if (!record.merkleProof || !Array.isArray(record.merkleProof)) {
      throw new NotFoundException(
        'Merkle proof not found or invalid for this distribution record.',
      );
    }

    const amtFloat = Number(record.amount);
    if (isNaN(amtFloat)) {
      throw new BadRequestException(
        'Invalid payout amount format in distribution record.',
      );
    }

    // Convert stored net amount to exact wei string matching on-chain submission
    const weiAmountString = ethers
      .parseUnits(amtFloat.toFixed(2), this.TOKEN_DECIMALS)
      .toString();

    const normalizedAddress = ethers.getAddress(record.walletAddress.trim());

    return {
      batchId: cleanBatchId,
      account: normalizedAddress,
      amount: weiAmountString,
      proof: record.merkleProof,
    };
  }

  async confirmOnChainClaim(batchId: string, userId: string) {
    const cleanBatchId = batchId.trim();
    return await this.dataSource.transaction(async (manager) => {
      const investor = await manager.findOne(InvestorProfile, {
        where: { user: { id: userId } },
      });
      if (!investor) {
        throw new NotFoundException('Investor profile not found for user.');
      }

      const distRows = await manager.query(
        `SELECT id, status, "investorId" FROM distributions WHERE "batchId" = $1 AND "investorId" = $2 LIMIT 1`,
        [cleanBatchId, investor.id],
      );

      if (!distRows || distRows.length === 0) {
        throw new NotFoundException(
          'On-chain distribution record not found for user.',
        );
      }

      await manager.query(
        `UPDATE distributions SET status = 'PAID', "updatedAt" = NOW() WHERE id = $1`,
        [distRows[0].id],
      );

      return { success: true, status: 'PAID' };
    });
  }
}
