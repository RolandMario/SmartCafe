import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/configuration';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { CatalogModule } from './catalog/catalog.module';
import { VendorModule } from './vendors/vendor.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AirtimeModule } from './airtime/airtime.module';
import { DataModule } from './data/data.module';
import { CableModule } from './cable/cable.module';
import { ElectricityModule } from './electricity/electricity.module';
import { WaecModule } from './waec/waec.module';
import { JambModule } from './jamb/jamb.module';
import { SmsModule } from './sms/sms.module';
import { FundingModule } from './funding/funding.module';
import { AdminModule } from './admin/admin.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    VendorModule,
    AuthModule,
    UsersModule,
    WalletModule,
    CatalogModule,
    TransactionsModule,
    AirtimeModule,
    DataModule,
    CableModule,
    ElectricityModule,
    WaecModule,
    JambModule,
    SmsModule,
    FundingModule,
    PaymentsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}