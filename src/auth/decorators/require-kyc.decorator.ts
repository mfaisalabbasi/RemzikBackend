import { SetMetadata } from '@nestjs/common';

export const REQUIRE_KYC_KEY = 'require_kyc';

export const RequireKyc = () => SetMetadata(REQUIRE_KYC_KEY, true);
