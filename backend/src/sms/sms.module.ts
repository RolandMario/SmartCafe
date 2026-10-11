import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [SmsController],
  providers: [SmsService],
})
export class SmsModule {}