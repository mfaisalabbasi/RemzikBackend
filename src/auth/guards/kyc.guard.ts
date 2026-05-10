import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/user/user.entity'; // ✅ Import User Entity
import { KycProfile } from 'src/kyc/kyc.entity';
import { KycStatus } from 'src/kyc/enums/kyc-status.enum';
import { PartnerProfile } from '../../partner/partner.entity';
import { PartnerStatus } from '../../partner/enums/partner-status.enum';
import { UserRole } from 'src/user/enums/user-role.enum';

@Injectable()
export class KycGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>, // ✅ Inject User Repo
    @InjectRepository(KycProfile)
    private readonly kycRepo: Repository<KycProfile>,
    @InjectRepository(PartnerProfile)
    private readonly partnerRepo: Repository<PartnerProfile>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userPayload = request.user;
    const userId = userPayload?.userId || userPayload?.id;

    if (!userId) {
      throw new ForbiddenException('User identification missing');
    }

    // --- GATE 0: LIVE DATABASE CHECK (The Kill-Switch) ---
    // We fetch from DB to catch the "Freeze" action instantly
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user || user.isActive === false) {
      throw new ForbiddenException(
        'This account is restricted or inactive. Please contact support.',
      );
    }

    // --- GATE 1: INDIVIDUAL KYC ---
    const kyc = await this.kycRepo.findOne({
      where: { user: { id: userId } },
    });

    if (!kyc || kyc.status !== KycStatus.APPROVED) {
      throw new ForbiddenException(
        `Personal KYC is ${kyc?.status || 'MISSING'}. Approval required.`,
      );
    }

    // --- GATE 2: ROLE-SPECIFIC (Partners Only) ---
    if (user.role === UserRole.PARTNER) {
      const partner = await this.partnerRepo.findOne({
        where: { user: { id: userId } },
      });

      if (!partner || partner.status !== PartnerStatus.APPROVED) {
        throw new ForbiddenException(
          `Business verification is ${partner?.status || 'PENDING'}. Corporate approval required.`,
        );
      }
    }

    return true;
  }
}
