import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment } from 'src/investment/investment.entity';
import { Payout } from 'src/payout/payout.entity';
import { LedgerEntry } from 'src/ledger/ledger.entity';
import { Trade } from '../trade/trade.entity';
import { GenerateReportDto } from './dto/generate-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportType } from './enums/report-type.enum';
import { Between } from 'typeorm';
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,

    @InjectRepository(Payout)
    private readonly payoutRepo: Repository<Payout>,

    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,

    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
  ) {}

  async generateReport(dto: GenerateReportDto): Promise<ReportResponseDto> {
    const { reportType, userId, partnerId, startDate, endDate } = dto;

    let investments, payouts, ledgerEntries, trades;

    // Filter by date
    const start = new Date(startDate);
    const end = new Date(endDate);

    switch (reportType) {
      case ReportType.INVESTOR:
        investments = await this.investmentRepo.find({
          where: { investor: { id: userId }, createdAt: Between(start, end) },
        });

        payouts = await this.payoutRepo.find({
          where: { investor: { id: userId }, createdAt: Between(start, end) },
        });

        ledgerEntries = await this.ledgerRepo.find({
          where: { userId, createdAt: Between(start, end) },
        });

        trades = await this.tradeRepo.find({
          where: [
            { buyer: { id: userId }, executedAt: Between(start, end) },
            { seller: { id: userId }, executedAt: Between(start, end) },
          ],
        });
        break;

      case ReportType.PARTNER:
        // Partner reports: assets + investment received + distributions
        // Connect via asset ownership
        investments = await this.investmentRepo
          .createQueryBuilder('inv')
          .leftJoinAndSelect('inv.asset', 'asset')
          .where('asset.partnerId = :partnerId', { partnerId })
          .andWhere('inv.createdAt BETWEEN :start AND :end', { start, end })
          .getMany();

        payouts = await this.payoutRepo
          .createQueryBuilder('payout')
          .leftJoin('payout.investor', 'inv')
          .leftJoin('inv.asset', 'asset')
          .where('asset.partnerId = :partnerId', { partnerId })
          .andWhere('payout.createdAt BETWEEN :start AND :end', { start, end })
          .getMany();

        ledgerEntries = await this.ledgerRepo
          .createQueryBuilder('ledger')
          .leftJoin('ledger.user', 'user')
          .leftJoin('user.assets', 'asset')
          .where('asset.partnerId = :partnerId', { partnerId })
          .andWhere('ledger.createdAt BETWEEN :start AND :end', { start, end })
          .getMany();

        trades = await this.tradeRepo
          .createQueryBuilder('trade')
          .leftJoin('trade.buyOrder', 'buy')
          .leftJoin('trade.sellOrder', 'sell')
          .where('buy.partnerId = :partnerId OR sell.partnerId = :partnerId', {
            partnerId,
          })
          .andWhere('trade.executedAt BETWEEN :start AND :end', { start, end })
          .getMany();
        break;

      case ReportType.ADMIN:
        investments = await this.investmentRepo.find({
          where: { createdAt: Between(start, end) },
        });

        payouts = await this.payoutRepo.find({
          where: { createdAt: Between(start, end) },
        });

        ledgerEntries = await this.ledgerRepo.find({
          where: { createdAt: Between(start, end) },
        });

        trades = await this.tradeRepo.find({
          where: { executedAt: Between(start, end) },
        });
        break;

      default:
        throw new Error('Invalid report type');
    }

    const totalInvested = investments.reduce(
      (sum, inv) => sum + Number(inv.amount),
      0,
    );

    const totalDistributed = ledgerEntries
      .filter((l) => l.type === 'DISTRIBUTION')
      .reduce((sum, l) => sum + Number(l.amount), 0);

    const totalPayouts = payouts.reduce((sum, p) => sum + Number(p.amount), 0);

    const totalAssets = new Set(investments.map((inv) => inv.asset.id)).size;

    return {
      totalInvested,
      totalDistributed,
      totalPayouts,
      totalAssets,
      ledgerEntries,
      trades,
    };
  }
}
