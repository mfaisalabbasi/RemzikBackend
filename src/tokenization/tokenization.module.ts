import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenizationService } from './tokenization.service';
import { TokenizationController } from './tokenization.controller';
import { AssetToken } from './entities/asset-token.entity';
import { Asset } from '../asset/asset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AssetToken, Asset])],
  providers: [TokenizationService],
  controllers: [TokenizationController],
  exports: [TokenizationService],
})
export class TokenizationModule {}
