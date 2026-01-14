import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerProfile } from 'src/partner/partner.entity';
import { PartnerStatus } from 'src/partner/enums/partner-status.enum';
@Injectable()
export class PartnerApprovedGuard implements CanActivate {
  constructor(
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    const partner = await this.partnerRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!partner || partner.status !== PartnerStatus.APPROVED) {
      throw new ForbiddenException('Approved partner required');
    }

    return true;
  }
}
