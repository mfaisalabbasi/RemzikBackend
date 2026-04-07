import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { LedgerEntry } from './ledger.entity';
import { LedgerSource } from './enums/ledger-source.enum';
import { LedgerType } from './enums/ledger-type.enum';

@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(LedgerEntry) : this.ledgerRepo;
  }

  async findByUser(userId: string): Promise<LedgerEntry[]> {
    const realTransactions = await this.ledgerRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    // If real data exists, return ONLY that.
    if (realTransactions.length > 0) return realTransactions;

    // ✅ FIX: Unique ID per user prevents frontend "merging" bugs
    // ✅ FIX: Use LedgerType.CREDIT to ensure it's treated as positive balance
    return [
      {
        id: `dummy-init-${userId}`,
        userId,
        amount: 15000.0,
        type: LedgerType.CREDIT,
        source: LedgerSource.INVESTMENT_CONFIRMATION,
        note: 'Initial Portfolio Deposit (Demo)',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as LedgerEntry[];
  }

  async createEntry(
    userId: string,
    amount: number,
    type: LedgerType,
    source: LedgerSource,
    note?: string,
    manager?: EntityManager,
  ): Promise<LedgerEntry> {
    const repo = this.getRepo(manager);

    const entry = repo.create({
      userId,
      amount: Number(amount),
      type,
      source,
      note,
    });

    return await repo.save(entry);
  }

  async record(
    data: {
      userId: string;
      amount: number;
      type: LedgerType;
      source: LedgerSource;
      reference?: string;
      description?: string;
      note?: string;
    },
    manager?: EntityManager,
  ) {
    const repo = this.getRepo(manager);
    const entry = repo.create(data);
    return await repo.save(entry);
  }

  async recordDisputeAdjustment(
    userId: string,
    amount: number,
    referenceId: string,
    manager?: EntityManager,
  ) {
    const repo = this.getRepo(manager);
    return await repo.save({
      userId,
      type: LedgerType.DISPUTE_ADJUSTMENT,
      amount: Number(amount),
      reference: referenceId,
    });
  }

  async findByFilter(
    userId: string,
    type?: LedgerType,
    source?: LedgerSource,
  ): Promise<LedgerEntry[]> {
    const query = this.ledgerRepo.createQueryBuilder('ledger');
    query.where('ledger.userId = :userId', { userId });

    if (type) query.andWhere('ledger.type = :type', { type });
    if (source) query.andWhere('ledger.source = :source', { source });

    return query.orderBy('ledger.createdAt', 'DESC').getMany();
  }
}
