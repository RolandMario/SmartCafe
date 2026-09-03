import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VendorService } from './vendor.service';
import { MockProvider } from './providers/mock.provider';
import { VtpassProvider } from './providers/vtpass.provider';
import { EbulksmsProvider } from './providers/ebulksms.provider';
import { VendorConfig, VendorConfigSchema } from './schemas/vendor-config.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VendorConfig.name, schema: VendorConfigSchema },
    ]),
  ],
  providers: [VendorService, MockProvider, VtpassProvider, EbulksmsProvider],
  exports: [VendorService],
})
export class VendorModule {}