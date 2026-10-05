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
import { PrivyClient, NotFoundError } from '@privy-io/node';
import { ethers } from 'ethers';
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

    // Return immediately if already synced
    if (user.walletAddress && user.privyUserId) {
      return {
        walletAddress: user.walletAddress,
        privyUserId: user.privyUserId,
      };
    }

    try {
      let privyUser;

      // 1. Try to fetch user from Privy by email
      try {
        privyUser = await this.privy
          .users()
          .getByEmailAddress({ address: user.email });
      } catch (err: any) {
        // If not found (or any lookup issue on new user), create them with an Ethereum wallet
        console.log(
          'ℹ️ User not found in Privy, creating new Privy identity & wallet...',
        );
        privyUser = await this.privy.users().create({
          linked_accounts: [{ type: 'email', address: user.email }],
          wallets: [{ chain_type: 'ethereum' }],
        });
      }

      // 2. Locate or create their Ethereum wallet address
      let walletAddress: string | undefined;
      const ethereumWallet = privyUser.linked_accounts?.find(
        (acc: any) => acc.type === 'wallet' && acc.chain_type === 'ethereum',
      );

      if (ethereumWallet) {
        walletAddress = (ethereumWallet as any).address;
      } else {
        const newWallet = await this.privy.wallets().create({
          chain_type: 'ethereum',
          owner: { user_id: privyUser.id },
        });
        walletAddress = newWallet.address;
      }

      // 3. Save mapping back to PostgreSQL
      user.privyUserId = privyUser.id;
      user.walletAddress = walletAddress;
      await this.userRepository.save(user);

      console.log(
        `✅ [Privy] Wallet successfully provisioned: ${walletAddress} for user ${user.email}`,
      );

      return {
        walletAddress,
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

    user.walletAddress = ethers.getAddress(walletAddress);
    user.privyUserId = privyUserId;

    await this.userRepository.save(user);

    return {
      walletAddress: user.walletAddress,
      privyUserId: user.privyUserId,
    };
  }
}
