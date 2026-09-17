import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../../../user/user.entity'; // Adjust path if your User entity lives elsewhere
@Injectable()
export class IdentityEventHandler {
  private readonly logger = new Logger(IdentityEventHandler.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Handles the IdentityUpdated event from the RemzikIdentityRegistry contract.
   * Automatically updates the user's KYC verification status in the PostgreSQL database.
   */
  async handleIdentityUpdated(
    investorWallet: string,
    isVerified: boolean,
    txHash: string,
  ): Promise<void> {
    const userRepository = this.dataSource.getRepository(User);

    try {
      // Find user by their wallet address (case-insensitive search if supported, or direct match)
      const user = await userRepository.findOne({
        where: { walletAddress: investorWallet },
      });

      if (!user) {
        this.logger.warn(
          `⚠️ IdentityUpdated event received for unknown wallet ${investorWallet} (Tx: ${txHash}). Skipping DB sync.`,
        );
        return;
      }

      // Check if status is already in sync to avoid redundant DB writes
      if (user.isVerified === isVerified) {
        return;
      }

      user.isVerified = isVerified;
      await userRepository.save(user);

      this.logger.log(
        `✅ Successfully synced IdentityUpdated for wallet ${investorWallet} -> isVerified: ${isVerified} (Tx: ${txHash})`,
      );
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to handle IdentityUpdated event for wallet ${investorWallet}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Handles the IdentityFreezeToggled event from the RemzikIdentityRegistry contract.
   * Updates the user's freeze status in the PostgreSQL database if applicable.
   */
  async handleIdentityFreezeToggled(
    investorWallet: string,
    isFrozen: boolean,
    txHash: string,
  ): Promise<void> {
    const userRepository = this.dataSource.getRepository(User);

    try {
      const user = await userRepository.findOne({
        where: { walletAddress: investorWallet },
      });

      if (!user) {
        this.logger.warn(
          `⚠️ IdentityFreezeToggled event received for unknown wallet ${investorWallet} (Tx: ${txHash}). Skipping DB sync.`,
        );
        return;
      }

      // If your User entity has a 'isFrozen' property, update it.
      // If it's named differently (e.g., 'status'), adjust it here.
      if ('isFrozen' in user && (user as any).isFrozen !== isFrozen) {
        (user as any).isFrozen = isFrozen;
        await userRepository.save(user);
        this.logger.log(
          `🔒 Successfully synced IdentityFreezeToggled for wallet ${investorWallet} -> isFrozen: ${isFrozen} (Tx: ${txHash})`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to handle IdentityFreezeToggled event for wallet ${investorWallet}: ${error.message}`,
        error.stack,
      );
    }
  }
}
