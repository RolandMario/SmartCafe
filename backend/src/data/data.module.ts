import { Module } from '@nestjs/common';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [TransactionsModule, CatalogModule],
  controllers: [DataController],
  providers: [DataService],
})
export class DataModule {}