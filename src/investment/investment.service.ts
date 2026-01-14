import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment } from './investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { InvestorProfile } from 'src/investor/investor.entity';
import { Asset } from '../asset/asset.entity';
import { AssetStatus } from '../asset/enums/asset-status.enum';
import { InvestmentStatus } from './enums/investment-status.enum';

@Injectable()
export class InvestmentService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,

    @InjectRepository(InvestorProfile)
    private readonly investorRepo: Repository<InvestorProfile>,

    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  /**
   * Create investment intent
   */
  async createInvestment(
    userId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    const investor = await this.investorRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!investor) {
      throw new BadRequestException('Investor profile required');
    }

    const asset = await this.assetRepo.findOne({
      where: { id: dto.assetId },
    });

    if (!asset || asset.status !== AssetStatus.APPROVED) {
      throw new BadRequestException('Asset not available for investment');
    }

    const investedSoFar = await this.investmentRepo
      .createQueryBuilder('investment')
      .select('SUM(investment.amount)', 'total')
      .where('investment.assetId = :assetId', { assetId: asset.id })
      .andWhere('investment.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      })
      .getRawOne();

    const totalInvested = Number(investedSoFar.total || 0);

    if (totalInvested + dto.amount > Number(asset.totalValue)) {
      throw new BadRequestException('Investment exceeds asset value');
    }

    const investment = this.investmentRepo.create({
      investor,
      asset,
      amount: dto.amount,
      status: InvestmentStatus.PENDING,
    });

    return this.investmentRepo.save(investment);
  }

  /**
   * Simulate payment confirmation (ADMIN / GATEWAY)
   */
  async confirmInvestment(id: string): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: { id },
    });

    if (!investment) {
      throw new NotFoundException('Investment not found');
    }

    investment.status = InvestmentStatus.CONFIRMED;
    return this.investmentRepo.save(investment);
  }

  /**
   * Investor portfolio
   */
  async getMyInvestments(userId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investor: { user: { id: userId } } },
      relations: ['asset'],
    });
  }
}
