import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { Funding, FundingSchema } from './schemas/funding.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Funding.name, schema: FundingSchema },
      { name: User.name, schema: UserSchema },
    ]),
    WalletModule,
    PaymentsModule,
  ],
  controllers: [FundingController],
  providers: [FundingService],
  exports: [FundingService],
})
export class FundingModule {}