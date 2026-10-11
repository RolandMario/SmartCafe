import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
  providers: [PaystackService, PaymentGatewayRegistry],
  exports: [PaystackService, PaymentGatewayRegistry],
})
export class PaymentsModule {}