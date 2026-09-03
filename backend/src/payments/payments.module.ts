import { Module } from '@nestjs/common';
import { MonnifyService } from './monnify.service';
import { PaystackService } from './paystack.service';
import { PaymentGatewayRegistry } from './payment-gateway.registry';

@Module({
  providers: [MonnifyService, PaystackService, PaymentGatewayRegistry],
  exports: [MonnifyService, PaystackService, PaymentGatewayRegistry],
})
export class PaymentsModule {}