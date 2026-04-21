import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/asset/asset.service';
import { InvestmentService } from 'src/investment/investment.service';
import { PartnerService } from 'src/partner/partner.service';
import { PayoutService } from 'src/payout/payout.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly investmentService: InvestmentService,
    private readonly payoutService: PayoutService,
    private readonly assetService: AssetService,
    private readonly partnerService: PartnerService,
  ) {}

  // Get analytics for a user
  async getUserAnalytics(userId: string) {
    const investments = await this.investmentService.getByUser(userId);
    const payouts = await this.payoutService.getByUser(userId);

    return {
      totalInvested: investments.reduce(
        (sum, inv) => sum + Number(inv.amount),
        0,
      ),
      totalPayouts: payouts.reduce((sum, p) => sum + Number(p.amount), 0),
    };
  }

  // Get analytics for a partner
  async getPartnerAnalytics(partnerId: string) {
    const assets = await this.assetService.getByPartner(partnerId);

    let totalRaised = 0;
    let totalDistributed = 0;

    for (const asset of assets) {
      totalRaised += await this.investmentService.getTotalByAsset(asset.id);
      totalDistributed += await this.payoutService.getTotalByAsset(asset.id);
    }

    return {
      totalRaised,
      totalDistributed,
      totalAssets: assets.length,
    };
  }

  // Admin-wide analytics
  async getAdminAnalytics() {
    return {
      // AUM: Total amount invested across the entire system
      totalAUM: await this.investmentService.getTotalInvested(),
      // Counts from respective services
      investorCount: await this.investmentService.countUniqueInvestors(),
      partnerCount: await this.partnerService.countPartners(), // Ensure partnerService is injected
      liveAssets: await this.assetService.countAssets(),
    };
  }
}
