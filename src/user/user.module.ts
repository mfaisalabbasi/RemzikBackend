import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { User } from './user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';

import { PartnerModule } from '../partner/partner.module';
import { InvestorModule } from '../investor/investor.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),

    PartnerModule,
    InvestorModule,
    StorageModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || '',
        signOptions: {
          expiresIn: configService.get<any>('JWT_EXPIRES_IN') || '1h',
        },
      }),
    }),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService, JwtModule],
})
export class UserModule {}
