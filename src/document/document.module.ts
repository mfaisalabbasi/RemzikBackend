import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetDocument } from './document.entity';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { Asset } from '../asset/asset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AssetDocument, Asset])],
  providers: [DocumentService],
  controllers: [DocumentController],
})
export class DocumentModule {}
