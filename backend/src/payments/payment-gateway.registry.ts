import { Injectable } from '@nestjs/common';
import { MonnifyService } from './monnify.service';
import { PaystackService } from './paystack.service';
import {
  PaymentGateway,
  PaymentProvider,
} from './payment-gateway.interface';

/**
 * Registry of payment gateway adapters, keyed by provider name.
 *
 * Gateways register themselves at DI-construction time. `resolve()` picks the
 * gateway for a new deposit: an explicit client choice if it is configured,
 * otherwise the first configured gateway in registration order
 * (monnify → paystack), otherwise null — in which case the funding service
 * falls back to the manual admin-approval flow.
 */
@Injectable()
export class PaymentGatewayRegistry {
  private readonly gateways = new Map<PaymentProvider, PaymentGateway>();

  constructor(
    monnify: MonnifyService,
    paystack: PaystackService,
  ) {
    this.register(monnify);
    this.register(paystack);
  }

  private register(gateway: PaymentGateway) {
    this.gateways.set(gateway.name, gateway);
  }

  all(): PaymentGateway[] {
    return [...this.gateways.values()];
  }

  /** Look up an adapter by provider name (null when unknown). */
  get(provider: string): PaymentGateway | null {
    return this.gateways.get(provider as PaymentProvider) ?? null;
  }

  /**
   * Resolve the gateway to use for a new deposit.
   * - `requested` given → that gateway only if it is configured, else null.
   * - `requested` omitted → first configured gateway in registration order.
   */
  resolve(requested?: string): PaymentGateway | null {
    if (requested) {
      const gateway = this.get(requested);
      return gateway?.isConfigured() ? gateway : null;
    }
    for (const gateway of this.gateways.values()) {
      if (gateway.isConfigured()) return gateway;
    }
    return null;
  }
}