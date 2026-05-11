import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateIncomeDto } from './dto/create-income.dto';
import { AssetIncome } from './asset-income.entity';

@Injectable()
export class IncomeService {
  constructor(
    @InjectRepository(AssetIncome)
    private readonly incomeRepo: Repository<AssetIncome>,
  ) {}

  /**
   * Merges the reported data with system-calculated net profit
   */
  async createReport(partnerUserId: string, dto: CreateIncomeDto) {
    const netAmount = dto.grossAmount - dto.expenses;

    if (netAmount <= 0) {
      throw new BadRequestException(
        'Expenses cannot be higher than Gross Income. No profit to distribute.',
      );
    }

    // Creating the record and linking the asset by ID
    const income = this.incomeRepo.create({
      asset: { id: dto.assetId },
      grossAmount: dto.grossAmount,
      expenses: dto.expenses,
      period: dto.period,
      documentUrl: dto.documentUrl,
      netAmount: netAmount,
      isDistributed: false,
    });

    return await this.incomeRepo.save(income);
  }

  /**
   * Retrieves all historical income reports for a specific asset
   */
  async getAssetHistory(assetId: string) {
    return await this.incomeRepo.find({
      where: { asset: { id: assetId } },
      order: { createdAt: 'DESC' },
      relations: ['asset'], // Added relation if you need asset details in history
    });
  }
}
