import { Module } from '@nestjs/common';
import { WaecController } from './waec.controller';
import { WaecService } from './waec.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [WaecController],
  providers: [WaecService],
})
export class WaecModule {}