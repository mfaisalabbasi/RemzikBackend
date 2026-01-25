import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Get analytics for an investor/user
   */
  @Get('investor/:userId')
  async investorReport(@Param('userId') userId: string) {
    return this.analyticsService.getUserAnalytics(userId); // <-- fixed
  }

  /**
   * Get analytics for a partner
   */
  @Get('partner/:partnerId')
  async partnerReport(@Param('partnerId') partnerId: string) {
    return this.analyticsService.getPartnerAnalytics(partnerId); // <-- fixed
  }

  /**
   * Admin-wide analytics
   */
  @Get('admin')
  async adminReport() {
    return this.analyticsService.getAdminAnalytics(); // <-- fixed
  }
}
