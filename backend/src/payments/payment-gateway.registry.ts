import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MonnifyService } from './monnify.service';
import { PaystackService } from './paystack.service';
import {
  PaymentGateway,
  PaymentProvider,
} from './payment-gateway.interface';
import {
  PaymentGatewayConfig,
} from './schemas/payment-gateway-config.schema';

/**
 * Registry of payment gateway adapters, keyed by provider name.
 *
 * Gateways register themselves at DI-construction time. A gateway is ACTIVE
 * for new deposits only when it is both **configured** (adapter.isConfigured()
 * — env credentials present) and **enabled by an admin** (a persisted row in
 * the `paymentgatewayconfigs` collection, defaulting to enabled).
 *
 * `resolve()` picks the active gateway for a new deposit: an explicit client
 * choice if it is active, otherwise the first active gateway in registration
 * order (monnify → paystack), otherwise null — in which case the funding
 * service falls back to the manual admin-approval flow.
 *
 * `get()` deliberately returns the adapter regardless of the admin toggle:
 * verification and webhook settlement for a checkout already started must keep
 * working even if the admin disables a gateway mid-flight.
 */
@Injectable()
export class PaymentGatewayRegistry implements OnModuleInit {
  private readonly logger = new Logger(PaymentGatewayRegistry.name);
  private readonly gateways = new Map<PaymentProvider, PaymentGateway>();

  /** Admin toggles, keyed by provider name (absent = admin-enabled). */
  private readonly enabledByAdmin = new Map<PaymentProvider, boolean>();

  constructor(
    monnify: MonnifyService,
    paystack: PaystackService,
    @InjectModel(PaymentGatewayConfig.name)
    private configModel: Model<PaymentGatewayConfig>,
  ) {
    this.register(monnify);
    this.register(paystack);
  }

  private register(gateway: PaymentGateway) {
    this.gateways.set(gateway.name, gateway);
  }

  async onModuleInit() {
    const docs = await this.configModel.find().lean();
    for (const doc of docs) {
      this.enabledByAdmin.set(doc.provider, doc.enabled);
    }
    for (const name of this.gateways.keys()) {
      if (!this.enabledByAdmin.has(name)) {
        await this.ensureRow(name, true);
      }
    }
    this.logger.log(
      `Loaded payment gateway toggles: ${[...this.gateways.keys()]
        .map((n) => `${n}=${this.isEnabled(n) ? 'enabled' : 'disabled'}`)
        .join(', ')}`,
    );
  }

  /** Seed a persisted row for a provider that has none (opt-out default: enabled). */
  private async ensureRow(provider: PaymentProvider, enabled: boolean) {
    try {
      await this.configModel.updateOne(
        { provider },
        { $set: { provider, enabled } },
        { upsert: true },
      );
      this.enabledByAdmin.set(provider, enabled);
    } catch (err: any) {
      this.logger.warn(
        `Could not seed default toggle for ${provider}: ${String(err)}`,
      );
    }
  }

  /** Whether an admin has explicitly disabled this provider (default: enabled). */
  isEnabled(provider: PaymentProvider): boolean {
    return this.enabledByAdmin.get(provider) !== false;
  }

  /** Persist an admin toggle and apply it immediately (no restart). */
  async setEnabled(
    provider: PaymentProvider,
    enabled: boolean,
    updatedBy?: string,
  ): Promise<PaymentGatewayConfig> {
    const doc = await this.configModel.findOneAndUpdate(
      { provider },
      {
        $set: {
          provider,
          enabled,
          updatedBy: updatedBy
            ? (updatedBy as unknown as Types.ObjectId)
            : null,
        },
      },
      { upsert: true, new: true },
    );
    this.enabledByAdmin.set(provider, enabled);
    this.logger.log(
      `Payment gateway ${provider} → ${enabled ? 'enabled' : 'disabled'} by admin`,
    );
    return doc;
  }

  all(): PaymentGateway[] {
    return [...this.gateways.values()];
  }

  /** Look up an adapter by provider name (null when unknown). */
  get(provider: string): PaymentGateway | null {
    return this.gateways.get(provider as PaymentProvider) ?? null;
  }

  /**
   * A gateway is usable for NEW deposits only when it is configured AND
   * admin-enabled.
   */
  isActive(gateway: PaymentGateway): boolean {
    return (
      gateway.isConfigured() &&
      this.isEnabled(gateway.name)
    );
  }

  /**
   * Overview for the admin UI: per-provider configuration + toggle state.
   */
  overview(): {
    provider: PaymentProvider;
    label: string;
    configured: boolean;
    enabled: boolean;
    active: boolean;
  }[] {
    return this.all().map((gateway) => {
      const enabled = this.isEnabled(gateway.name);
      const configured = gateway.isConfigured();
      return {
        provider: gateway.name,
        label: gateway.label,
        configured,
        enabled,
        active: configured && enabled,
      };
    });
  }

  /**
   * Resolve the ACTIVE gateway to use for a new deposit.
   * - `requested` given → that gateway only if it is active, else null.
   * - `requested` omitted → first active gateway in registration order.
   */
  resolve(requested?: string): PaymentGateway | null {
    if (requested) {
      const gateway = this.get(requested);
      return gateway && this.isActive(gateway) ? gateway : null;
    }
    for (const gateway of this.gateways.values()) {
      if (this.isActive(gateway)) return gateway;
    }
    return null;
  }
}