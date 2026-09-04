import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonnifyService } from './monnify.service';
import { PaystackService } from './paystack.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import {
  PaymentGatewayConfig,
  PaymentGatewayConfigSchema,
} from './schemas/payment-gateway-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PaymentGatewayConfig.name,
        schema: PaymentGatewayConfigSchema,
      },
    ]),
  ],
  providers: [MonnifyService, PaystackService, PaymentGatewayRegistry],
  exports: [MonnifyService, PaystackService, PaymentGatewayRegistry],
})
export class PaymentsModule {}