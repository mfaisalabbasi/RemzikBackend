import { Injectable } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationType } from './enums/notification-type.enum';

@Injectable()
export class NotificationOrchestrator {
  constructor(
    private readonly service: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async buildAndSave(userId: string, eventName: string, data: any) {
    let config = {
      title: 'Update',
      message: data?.message || 'You have a new notification.',
      actionUrl: '/dashboard',
      type: NotificationType.INFO,
    };

    // ---------------------------------------------------------
    // 1. INVESTMENTS & FUNDING
    // ---------------------------------------------------------
    if (eventName === 'investment.created') {
      config = {
        title: 'Investment Confirmed!',
        message:
          data.message ||
          `SAR ${Number(data.amount)?.toLocaleString()} invested in "${data.asset}".`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'investment.partner.funded') {
      config = {
        title: 'New Investment Funded',
        message:
          data.message ||
          `An investment of SAR ${Number(data.amount)?.toLocaleString()} was successfully completed for your asset "${data.asset}".`,
        actionUrl: data.actionUrl || '/partner/funding',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'investment.intent_created') {
      config = {
        title: 'On-Chain Intent Ready',
        message:
          data.message ||
          `Please sign your on-chain transaction of SAR ${data.amount} for "${data.asset}".`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.WARNING,
      };
    } else if (eventName === 'investment.failed') {
      config = {
        title: 'Investment Failed',
        message: data.message || `Your investment could not be completed.`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.ERROR,
      };
    }

    // ---------------------------------------------------------
    // 2. ASSETS & TOKENIZATION
    // ---------------------------------------------------------
    else if (eventName === 'asset.approved') {
      config = {
        title: 'Asset Approved!',
        message:
          data.message ||
          `Your asset listing "${data.asset}" has been approved and deployed on-chain.`,
        actionUrl: data.actionUrl || '/partner/assets',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'asset.rejected') {
      config = {
        title: 'Asset Listing Rejected',
        message:
          data.message ||
          `Your asset "${data.asset}" was rejected. Reason: ${data.reason}`,
        actionUrl: data.actionUrl || '/partner/assets',
        type: NotificationType.ERROR,
      };
    } else if (eventName === 'asset.tokenized') {
      config = {
        title: data.title || 'Asset Tokenized',
        message:
          data.message || `Your asset tokens have been deployed on-chain.`,
        actionUrl: data.actionUrl || '/partner/assets',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'asset.frozen') {
      config = {
        title: 'Asset Frozen',
        message: data.message || `Your asset listing has been frozen.`,
        actionUrl: data.actionUrl || '/partner/assets',
        type: NotificationType.WARNING,
      };
    } else if (
      eventName === 'asset.status_updated' ||
      eventName === 'asset.price_updated'
    ) {
      config = {
        title: data.title || 'Asset Updated',
        message: data.message || `Your asset details have been updated.`,
        actionUrl: data.actionUrl || '/partner/assets',
        type: NotificationType.INFO,
      };
    }

    // ---------------------------------------------------------
    // 3. DISPUTES & DISTRIBUTIONS
    // ---------------------------------------------------------
    else if (eventName === 'dispute.created') {
      config = {
        title: 'Dispute Case Opened',
        message:
          data.message ||
          `Your dispute case has been logged successfully and is under review.`,
        actionUrl: data.actionUrl || '/dashboard/disputes',
        type: NotificationType.WARNING,
      };
    } else if (eventName === 'dispute.resolved') {
      config = {
        title: 'Dispute Resolved',
        message:
          data.message ||
          `Your dispute has been concluded with status: ${data.status}.`,
        actionUrl: data.actionUrl || '/dashboard/disputes',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'distribution.batched') {
      config = {
        title: 'Distribution Batch Submitted',
        message:
          data.message ||
          `Your distribution batch has been created and is pending approval.`,
        actionUrl: data.actionUrl || '/partner/distribution',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'distribution.claimed') {
      config = {
        title: data.title || 'Yield Claimed',
        message:
          data.message || `Your yield payout has been successfully claimed.`,
        actionUrl: data.actionUrl || '/investor/distributions',
        type: NotificationType.SUCCESS,
      };
    }

    // ---------------------------------------------------------
    // 4. KYC, USER PROFILES & FREEZE STATES
    // ---------------------------------------------------------
    else if (eventName === 'kyc.submitted') {
      config = {
        title: 'KYC Submitted',
        message:
          data.message || `Your verification documents are under review.`,
        actionUrl: data.actionUrl || '/dashboard/kyc',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'kyc.approved') {
      config = {
        title: 'KYC Verified!',
        message:
          data.message || `Your identity has been successfully verified.`,
        actionUrl: data.actionUrl || '/dashboard',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'kyc.rejected') {
      config = {
        title: 'KYC Verification Rejected',
        message:
          data.message ||
          `Your verification was rejected. Reason: ${data.reason}`,
        actionUrl: data.actionUrl || '/dashboard/kyc',
        type: NotificationType.ERROR,
      };
    } else if (
      eventName === 'investor.profile_created' ||
      eventName === 'investor.profile_updated'
    ) {
      config = {
        title: data.title || 'Investor Account Updated',
        message: data.message || `Your account settings were saved.`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'user.registered') {
      config = {
        title: data.title || 'Welcome!',
        message: data.message || `Your account has been set up successfully.`,
        actionUrl: data.actionUrl || '/dashboard',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'user.wallet_linked') {
      config = {
        title: 'Wallet Connected',
        message: data.message || `Your wallet address has been linked.`,
        actionUrl: data.actionUrl || '/dashboard',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'user.frozen') {
      config = {
        title: 'Account Suspended',
        message: data.message || `Your account has been suspended.`,
        actionUrl: data.actionUrl || '',
        type: NotificationType.ERROR,
      };
    } else if (eventName === 'user.unfrozen') {
      config = {
        title: 'Account Reactivated',
        message: data.message || `Your account has been reactivated.`,
        actionUrl: data.actionUrl || '/dashboard',
        type: NotificationType.SUCCESS,
      };
    }

    // ---------------------------------------------------------
    // 5. OWNERSHIP & SECONDARY MARKETPLACE
    // ---------------------------------------------------------
    else if (
      eventName === 'ownership.shares_added' ||
      eventName === 'ownership.units_added'
    ) {
      config = {
        title: data.title || 'Portfolio Updated',
        message:
          data.message ||
          `Your portfolio units have been updated successfully.`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'ownership.units_removed') {
      config = {
        title: data.title || 'Units Transferred',
        message: data.message || `Portfolio units have been deducted.`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.INFO,
      };
    } else if (
      eventName === 'listing.created' ||
      eventName === 'listing.confirmed'
    ) {
      config = {
        title: data.title || 'Marketplace Listing Active',
        message: data.message || `Your units are listed for sale.`,
        actionUrl: data.actionUrl || '/investor/secondary',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'listing.cancelled') {
      config = {
        title: 'Listing Cancelled',
        message: data.message || `Your marketplace listing has been removed.`,
        actionUrl: data.actionUrl || '/investor/secondary',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'trade.intent_created') {
      config = {
        title: data.title || 'Trade Intent Initialized',
        message: data.message || `Your secondary market trade intent is ready.`,
        actionUrl: data.actionUrl || '/investor/secondary',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'trade.completed') {
      config = {
        title: data.title || 'Trade Completed Successfully!',
        message: data.message || `Your marketplace transaction has settled.`,
        actionUrl: data.actionUrl || '/investor/secondary',
        type: NotificationType.SUCCESS,
      };
    }

    // ---------------------------------------------------------
    // 6. PARTNERS
    // ---------------------------------------------------------
    else if (
      eventName === 'partner.created' ||
      eventName === 'partner.docs_uploaded'
    ) {
      config = {
        title: data.title || 'Partner Profile Under Review',
        message:
          data.message ||
          `Your business submission is currently being reviewed.`,
        actionUrl: data.actionUrl || '/partner/profile',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'partner.approved') {
      config = {
        title: 'Partner Account Approved!',
        message:
          data.message || `Your company has been approved for asset issuance.`,
        actionUrl: data.actionUrl || '/partner',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'partner.rejected') {
      config = {
        title: 'Partner Application Rejected',
        message: data.message || `Your application was not approved.`,
        actionUrl: data.actionUrl || '/partner/profile',
        type: NotificationType.ERROR,
      };
    } else if (eventName === 'partner.frozen') {
      config = {
        title: 'Partner Account Suspended',
        message: data.message || `Your partner account has been suspended.`,
        actionUrl: data.actionUrl || '',
        type: NotificationType.ERROR,
      };
    } else if (eventName === 'partner.unfrozen') {
      config = {
        title: 'Partner Account Reactivated',
        message: data.message || `Your partner account has been reactivated.`,
        actionUrl: data.actionUrl || '/partner',
        type: NotificationType.SUCCESS,
      };
    }

    // ---------------------------------------------------------
    // 7. WALLET & RECOVERY
    // ---------------------------------------------------------
    else if (
      eventName === 'recovery.created' ||
      eventName === 'recovery.submitted'
    ) {
      config = {
        title: data.title || 'Wallet Recovery Update',
        message: data.message || `Your recovery request is being processed.`,
        actionUrl: data.actionUrl || '/investor/profile',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'recovery.completed') {
      config = {
        title: 'Wallet Recovery Successful!',
        message:
          data.message ||
          `Your wallet has been restored and assets transferred.`,
        actionUrl: data.actionUrl || '/investor/portfolio',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'recovery.failed') {
      config = {
        title: 'Wallet Recovery Failed',
        message:
          data.message || `Your recovery request could not be completed.`,
        actionUrl: data.actionUrl || '/investor/profile',
        type: NotificationType.ERROR,
      };
    } else if (eventName === 'wallet.topup') {
      config = {
        title: 'Wallet Funded',
        message: data.message || `Demo funds added successfully.`,
        actionUrl: data.actionUrl || '/investor/wallet',
        type: NotificationType.SUCCESS,
      };
    } else if (
      eventName === 'wallet.payout_requested' ||
      eventName === 'wallet.payout_completed'
    ) {
      config = {
        title: data.title || 'Payout Update',
        message: data.message || `Your withdrawal status has been updated.`,
        actionUrl: data.actionUrl || '/investor/wallet',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'wallet.payout_failed') {
      config = {
        title: 'Payout Failed',
        message: data.message || `Your payout request failed.`,
        actionUrl: data.actionUrl || '/investor/wallet',
        type: NotificationType.ERROR,
      };
    }

    // ---------------------------------------------------------
    // 8. GOVERNANCE
    // ---------------------------------------------------------
    else if (eventName === 'governance.proposal_created') {
      config = {
        title: data.title || 'New Governance Proposal',
        message: data.message || `A new proposal requires your review.`,
        actionUrl: data.actionUrl || '/partner/governance',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'governance.proposal_executed') {
      config = {
        title: data.title || 'Proposal Executed',
        message: data.message || `Governance proposal executed on-chain.`,
        actionUrl: data.actionUrl || '/partner/governance',
        type: NotificationType.SUCCESS,
      };
    } else if (eventName === 'governance.liquidated') {
      config = {
        title: 'Asset Liquidated',
        message: data.message || `Asset liquidation kill-switch triggered.`,
        actionUrl: data.actionUrl || '/partner/assets',
        type: NotificationType.ERROR,
      };
    }

    // ---------------------------------------------------------
    // 9. AUTHENTICATION (NO ACTION REDIRECT)
    // ---------------------------------------------------------
    else if (eventName === 'auth.login') {
      config = {
        title: data.title || 'Session Started',
        message: data.message || `New sign-in detected.`,
        actionUrl: data.actionUrl || '',
        type: NotificationType.INFO,
      };
    } else if (eventName === 'auth.wallet_provisioned') {
      config = {
        title: 'Wallet Ready',
        message: data.message || `Your embedded wallet has been created.`,
        actionUrl: data.actionUrl || '',
        type: NotificationType.SUCCESS,
      };
    }

    // ---------------------------------------------------------
    // 10. DYNAMIC FALLBACK
    // ---------------------------------------------------------
    else if (data?.title && data?.message) {
      config = {
        title: data.title,
        message: data.message,
        actionUrl: data.actionUrl || '/dashboard',
        type: data.type || NotificationType.INFO,
      };
    }

    const notification = await this.service.create({ userId, ...config });
    this.gateway.sendNotification(userId, notification);
    return notification;
  }
}
