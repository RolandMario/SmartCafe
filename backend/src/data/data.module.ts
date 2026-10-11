import { Module } from '@nestjs/common';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [DataController],
  providers: [DataService],
})
export class DataModule {}