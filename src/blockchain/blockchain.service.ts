import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnchainMapping } from './entities/onchain-mapping.entity';
import { Repository } from 'typeorm';
import { TokenizationService } from 'src/tokenization/tokenization.service';
import { Chain } from './enums/chain.enum';

@Injectable()
export class BlockchainService {
  constructor(
    @InjectRepository(OnchainMapping)
    private mappingRepo: Repository<OnchainMapping>,

    private readonly tokenizationService: TokenizationService,
  ) {}

  //Register Asset on Chain

  async registerAssetContract(
    assetId: string,
    contractAddress: string,
    chain: Chain,
  ) {
    const exists = await this.mappingRepo.findOne({
      where: { asset: { id: assetId }, chain },
    });

    if (exists) {
      throw new BadRequestException('Asset already registered on this chain');
    }

    return this.mappingRepo.save({
      asset: { id: assetId },
      contractAddress,
      chain,
      totalMinted: 0,
    });
  }

  //Mint Sync (CRITICAL LOGIC)

  async syncMint(assetId: string, chain: Chain, sharesToMint: number) {
    const mapping = await this.mappingRepo.findOne({
      where: { asset: { id: assetId }, chain },
    });

    if (!mapping) {
      throw new BadRequestException('Asset not registered on chain');
    }

    mapping.totalMinted += sharesToMint;

    // 🔐 Here we WOULD call blockchain (later)
    // mint(contractAddress, sharesToMint)

    return this.mappingRepo.save(mapping);
  }
}

// await this.blockchainService.syncMint(
//   assetId,
//   Chain.POLYGON,
//   shares,
// );
