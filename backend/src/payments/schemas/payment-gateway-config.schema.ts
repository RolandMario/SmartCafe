import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { PaymentProvider } from '../payment-gateway.interface';

/**
 * Persistent per-provider payment gateway toggle.
 *
 * Administrators can enable/disable a payment gateway (monnify | paystack)
 * without restarting the backend or editing env vars. A gateway is only usable
 * for new wallet funding requests when BOTH:
 *   - it is configured (env credentials present → adapter.isConfigured()), and
 *   - it is enabled here (this document exists with enabled = true).
 *
 * Missing rows default to enabled (opt-out), so existing deployments keep
 * working with no migration.
 */
@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc: any, ret: Record<string, any>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class PaymentGatewayConfig extends Document {
  @Prop({
    type: String,
    enum: ['monnify', 'paystack'],
    required: true,
    unique: true,
  })
  provider: PaymentProvider;

  @Prop({ type: Boolean, required: true, default: true })
  enabled: boolean;

  /** Admin user id that last changed this toggle (if known). */
  @Prop({ type: String, default: null })
  updatedBy?: string | null;
}

export const PaymentGatewayConfigSchema = SchemaFactory.createForClass(
  PaymentGatewayConfig,
);