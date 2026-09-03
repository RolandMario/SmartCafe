import { Module } from '@nestjs/common';
import { CableController } from './cable.controller';
import { CableService } from './cable.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [CableController],
  providers: [CableService],
})
export class CableModule {}