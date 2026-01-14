import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { PartnerModule } from './partner/partner.module';
import { AssetModule } from './asset/asset.module';
import { InvestmentModule } from './investment/investment.module';
import { KycModule } from './kyc/kyc.module';
import { KycGuard } from './auth/guards/kyc.guard';
import { PartnerApprovedGuard } from './auth/guards/partner-approved.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      imports: [
        ConfigModule,
        UserModule,
        AuthModule,
        PartnerModule,
        AssetModule,
        InvestmentModule,
        KycModule,
      ],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'), // ✅ safe
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true, // dev only
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // KycGuard,
    // PartnerApprovedGuard]
  ],
})
export class AppModule {}
