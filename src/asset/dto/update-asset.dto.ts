import { IsEnum } from 'class-validator';
import { AssetStatus } from '../enums/asset-status.enum';

export class UpdateAssetStatusDto {
  @IsEnum(AssetStatus)
  status: AssetStatus;
}
