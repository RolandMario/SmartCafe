import { Module } from '@nestjs/common';
import { JambController } from './jamb.controller';
import { JambService } from './jamb.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TransactionsModule, CatalogModule, UsersModule],
  controllers: [JambController],
  providers: [JambService],
})
export class JambModule {}