import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { Wallet, WalletSchema } from '../wallet/schemas/wallet.schema';
import { WalletLedger, WalletLedgerSchema } from '../wallet/schemas/wallet-ledger.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema';
import { Funding, FundingSchema } from '../funding/schemas/funding.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletLedger.name, schema: WalletLedgerSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Funding.name, schema: FundingSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}