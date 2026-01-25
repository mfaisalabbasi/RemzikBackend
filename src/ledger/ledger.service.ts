import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LedgerEntry } from './ledger.entity';
import { LedgerSource } from './enums/ledger-source.enum';
import { LedgerType } from './enums/ledger-type.enum';

@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
  ) {}

  /**
   * Create a new ledger entry
   * @param userId - who this entry belongs to
   * @param amount - positive = credit, negative = debit
   * @param type - LedgerType (broad category)
   * @param source - LedgerSource (specific event)
   * @param note - optional description
   */
  async createEntry(
    userId: string,
    amount: number,
    type: LedgerType,
    source: LedgerSource,
    note?: string,
  ): Promise<LedgerEntry> {
    const entry = this.ledgerRepo.create({
      userId,
      amount,
      type,
      source,
      note,
    });

    return this.ledgerRepo.save(entry);
  }

  /**
   * Get all ledger entries for a user
   */
  async findByUser(userId: string): Promise<LedgerEntry[]> {
    return this.ledgerRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Optional: Get ledger entries by type or source
   */
  async findByFilter(
    userId: string,
    type?: LedgerType,
    source?: LedgerSource,
  ): Promise<LedgerEntry[]> {
    const query = this.ledgerRepo.createQueryBuilder('ledger');
    query.where('ledger.userId = :userId', { userId });

    if (type) query.andWhere('ledger.type = :type', { type });
    if (source) query.andWhere('ledger.source = :source', { source });

    return query.orderBy('ledger.createdAt', 'ASC').getMany();
  }
}
