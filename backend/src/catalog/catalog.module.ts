import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CatalogItem, CatalogItemSchema } from './schemas/catalog-item.schema';
import { CatalogSyncStatus, CatalogSyncStatusSchema } from './schemas/catalog-sync-status.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CatalogItem.name, schema: CatalogItemSchema },
      { name: CatalogSyncStatus.name, schema: CatalogSyncStatusSchema },
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogSyncService],
  exports: [CatalogService, CatalogSyncService],
})
export class CatalogModule {}