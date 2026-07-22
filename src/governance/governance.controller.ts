import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GovernanceService } from './governance.service';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Asset } from '../asset/asset.entity';
import { GovernanceProposal } from './governance.entity';

@Controller('governance')
export class GovernanceController {
  constructor(
    private readonly governanceService: GovernanceService,
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    @InjectRepository(GovernanceProposal)
    private readonly proposalRepository: Repository<GovernanceProposal>,
  ) {}

  @Get(':assetId/proposals')
  async getProposals(@Param('assetId') assetId: string) {
    return this.proposalRepository.find({
      where: { asset: { id: assetId } },
      order: { createdAt: 'DESC' },
    });
  }

  @Post(':assetId/propose')
  async propose(
    @Param('assetId') assetId: string,
    @Body('desc') desc: string,
    @Body('duration') duration: number, // Added duration (in seconds)
  ) {
    if (!desc || !duration) {
      throw new BadRequestException('Description and duration are required.');
    }
    return this.governanceService.proposeAction(assetId, desc, duration);
  }

  @Post(':assetId/execute/:proposalId')
  async execute(
    @Param('assetId') assetId: string,
    @Param('proposalId') proposalId: number,
  ) {
    return this.governanceService.executeProposal(assetId, proposalId);
  }

  @Post(':assetId/liquidate')
  async liquidate(@Param('assetId') assetId: string) {
    const asset = await this.assetRepository.findOneBy({ id: assetId });

    if (!asset || !asset.governanceAddress) {
      throw new NotFoundException(
        'Asset not found or governance address not deployed.',
      );
    }

    return this.governanceService.triggerLiquidation(
      assetId,
      asset.governanceAddress,
    );
  }
}
