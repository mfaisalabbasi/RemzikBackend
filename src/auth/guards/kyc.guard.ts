import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycProfile } from 'src/kyc/kyc.entity';
import { KycStatus } from 'src/kyc/enums/kyc-status.enum';
import { REQUIRE_KYC_KEY } from '../decorators/require-kyc.decorator';

@Injectable()
export class KycGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireKyc = this.reflector.get<boolean>(
      REQUIRE_KYC_KEY,
      context.getHandler(),
    );

    if (!requireKyc) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    const kyc = await this.kycRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!kyc || kyc.status !== KycStatus.APPROVED) {
      throw new ForbiddenException('KYC approval required');
    }

    return true;
  }
}
