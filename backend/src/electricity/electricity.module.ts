import { Module } from '@nestjs/common';
import { ElectricityController } from './electricity.controller';
import { ElectricityService } from './electricity.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [ElectricityController],
  providers: [ElectricityService],
})
export class ElectricityModule {}