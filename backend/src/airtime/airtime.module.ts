import { Module } from '@nestjs/common';
import { AirtimeController } from './airtime.controller';
import { AirtimeService } from './airtime.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [AirtimeController],
  providers: [AirtimeService],
})
export class AirtimeModule {}