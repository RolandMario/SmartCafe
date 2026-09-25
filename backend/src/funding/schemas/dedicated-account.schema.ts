import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Provisioning state of a dedicated virtual account.
 * - pending — the bank is still provisioning the account (async assignment).
 * - active  — `accountNumber` is populated and the account receives transfers.
 * - failed  — assignment permanently failed (retry by creating again).
 */
export type DedicatedAccountStatus = 'pending' | 'active' | 'failed';

export const DEDICATED_ACCOUNT_STATUSES: readonly DedicatedAccountStatus[] = [
  'pending',
  'active',
  'failed',
];

/**
 * A user's personal bank account number (dedicated virtual account) issued by
 * the payment provider so customers can fund their wallet by bank transfer.
 * One per user — the provider's API only supports a single DVA per customer.
 */
@Schema({ timestamps: true })
export class DedicatedAccount extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  user: Types.ObjectId;

  /** Payment provider that issued the account (only 'paystack' today). */
  @Prop({ type: String, enum: ['paystack'], default: 'paystack' })
  provider: string;

  /** Provider customer code (CUS_...) — used to requery and match webhooks. */
  @Prop({ type: String, required: true, index: true })
  customerCode: string;

  @Prop({
    type: String,
    enum: DEDICATED_ACCOUNT_STATUSES,
    default: 'pending',
    index: true,
  })
  status: DedicatedAccountStatus;

  /** The 10-digit NUBAN the customer uses to receive transfers. */
  @Prop({ type: String })
  accountNumber?: string;

  /** Name the account was created under (usually the customer's name). */
  @Prop({ type: String })
  accountName?: string;

  /** Bank backing the account (e.g. Wema Bank / Test Bank). */
  @Prop({ type: String })
  bankName?: string;

  /** Numeric DVA id assigned by the provider, when known. */
  @Prop({ type: Number })
  providerAccountId?: number;

  /** Latest provider payload (create/requery/webhook) for audit. */
  @Prop({ type: Object })
  providerMeta?: Record<string, any>;

  @Prop({ type: Date })
  processedAt?: Date;

  /** Set automatically by `timestamps: true`. */
  createdAt?: Date;
  updatedAt?: Date;
}

export const DedicatedAccountSchema = SchemaFactory.createForClass(DedicatedAccount);