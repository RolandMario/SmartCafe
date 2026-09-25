import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VendorService } from './vendor.service';
import { MockProvider } from './providers/mock.provider';
import { VtpassProvider } from './providers/vtpass.provider';
import { EbulksmsProvider } from './providers/ebulksms.provider';
import { PairgateProvider } from './providers/pairgate.provider';
import { PeyflexProvider } from './providers/peyflex.provider';
import { VendorConfig, VendorConfigSchema } from './schemas/vendor-config.schema';
import { CatalogModule } from '../catalog/catalog.module';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VendorConfig.name, schema: VendorConfigSchema },
    ]),
    CatalogModule,
  ],
  providers: [VendorService, MockProvider, VtpassProvider, EbulksmsProvider, PairgateProvider, PeyflexProvider],
  exports: [VendorService],
})
export class VendorModule {}