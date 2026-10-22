// src/auth/wallet-provision.service.ts
import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { PrivyClient } from '@privy-io/node';
import { ethers } from 'ethers';

function normalizeAddress(address?: string | null): string {
  if (!address) return '';
  return address.replace(/["']/g, '').trim().toLowerCase();
}

@Injectable()
export class WalletProvisionService {
  private privy = new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
  });

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async provisionMobileWallet(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User profile not found');

    try {
      let privyUser;

      // 1. 🛡️ Fetch exact user by Privy ID if it exists
      if (user.privyUserId) {
        try {
          privyUser = await this.privy.users()._get(user.privyUserId);
        } catch (err) {
          console.log(
            `ℹ️ Stored privyUserId ${user.privyUserId} not found in Privy, fallback search by email...`,
          );
        }
      }

      // 2. Fallback: Search Privy by email to prevent duplicate containers
      if (!privyUser) {
        try {
          privyUser = await this.privy
            .users()
            .getByEmailAddress({ address: user.email });
          console.log(
            `✅ Found existing Privy user by email for ${user.email}: ${privyUser.id}`,
          );
        } catch (err: any) {
          console.log(
            'ℹ️ User truly not found in Privy, creating new Privy identity & wallet...',
          );
          privyUser = await this.privy.users().create({
            linked_accounts: [{ type: 'email', address: user.email }],
            wallets: [{ chain_type: 'ethereum' }],
          });
        }
      }

      // 3. 🛡️ EXACT WALLET EXTRACTION: Grab ANY existing Ethereum/embedded wallet from Privy first
      let ethereumWallet: any = null;

      if (
        privyUser.linked_accounts &&
        Array.isArray(privyUser.linked_accounts)
      ) {
        // Prioritize matching the database wallet if it exists
        if (user.walletAddress) {
          ethereumWallet = privyUser.linked_accounts.find(
            (acc: any) =>
              (acc.type === 'wallet' || acc.type === 'embedded') &&
              acc.chain_type === 'ethereum' &&
              normalizeAddress(acc.address) ===
                normalizeAddress(user.walletAddress),
          );
        }

        // If no explicit DB match, take the first available Ethereum wallet in Privy
        if (!ethereumWallet) {
          ethereumWallet = privyUser.linked_accounts.find(
            (acc: any) =>
              (acc.type === 'wallet' ||
                acc.type === 'embedded' ||
                acc.type === 'smart_wallet') &&
              acc.chain_type === 'ethereum' &&
              acc.address,
          );
        }
      }

      let walletAddress: string | undefined;

      if (ethereumWallet && ethereumWallet.address) {
        walletAddress = ethereumWallet.address;
      } else {
        // Only create a new wallet if the Privy container has zero Ethereum wallets
        console.log(
          'ℹ️ Privy user container has no Ethereum wallet, provisioning new wallet...',
        );
        const newWallet = await (this.privy as any).wallets().create({
          chain_type: 'ethereum',
          owner: { user_id: privyUser.id },
        });
        walletAddress = newWallet.address;
      }

      if (!walletAddress || !ethers.isAddress(walletAddress)) {
        throw new InternalServerErrorException(
          'Failed to obtain a valid Ethereum wallet address from Privy.',
        );
      }

      const formattedAddress = ethers.getAddress(walletAddress);

      // 🛡️ SELF-HEALING SYNC: Always align DB to match Privy's active wallet reality
      user.walletAddress = formattedAddress;
      user.privyUserId = privyUser.id;
      await this.userRepository.save(user);

      console.log(
        `✅ [Privy] Wallet synchronized with DB: ${user.walletAddress} for user ${user.email} (Privy ID: ${privyUser.id})`,
      );

      return {
        walletAddress: formattedAddress,
        privyUserId: privyUser.id,
      };
    } catch (error: any) {
      console.error('❌ Privy Server Wallet Creation Error:', error);
      throw new InternalServerErrorException(
        'Failed to provision Privy server wallet: ' + (error.message || error),
      );
    }
  }

  async syncPrivyWallet(
    userId: string,
    walletAddress: string,
    privyUserId: string,
  ) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!ethers.isAddress(walletAddress)) {
      throw new BadRequestException('Invalid wallet address.');
    }

    const formattedAddress = ethers.getAddress(walletAddress);

    // 🛡️ PERMITTED: Allow first-time setting if user has no wallet yet
    if (!user.walletAddress) {
      user.walletAddress = formattedAddress;
      user.privyUserId = privyUserId;
      await this.userRepository.save(user);

      console.log(
        `✅ [Wallet Provision] First-time wallet anchored: ${formattedAddress} for user ${userId}`,
      );

      return {
        walletAddress: user.walletAddress,
        privyUserId: user.privyUserId,
      };
    }

    // 🛡️ STRICT IMMUTABILITY LOCK: Prevent unauthorized/drift overrides of whitelisted wallets
    const existingNormalized = ethers.getAddress(user.walletAddress);

    if (existingNormalized.toLowerCase() !== formattedAddress.toLowerCase()) {
      console.warn(
        `⚠️ [Wallet Security] Blocked overwrite attempt for user ${userId}. Keeping whitelisted: ${existingNormalized}, Attempted: ${formattedAddress}`,
      );

      // Gracefully return the active whitelisted database wallet so the session aligns securely
      return {
        walletAddress: existingNormalized,
        privyUserId: user.privyUserId || privyUserId,
      };
    }

    // If addresses match, safely sync/update privyUserId
    user.privyUserId = privyUserId;
    await this.userRepository.save(user);

    console.log(
      `✅ [Wallet Sync] Verified active Privy wallet: ${formattedAddress}`,
    );

    return {
      walletAddress: user.walletAddress,
      privyUserId: user.privyUserId,
    };
  }
}
