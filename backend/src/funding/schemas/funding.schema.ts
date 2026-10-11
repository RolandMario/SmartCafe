import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { FundingStatus } from '../../common/enums';

@Schema({ timestamps: true })
export class Funding extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  // No floor here: bank-transfer DVA deposits can be any amount and are created
  // directly by the webhook. The user-facing DepositDto still enforces a ₦100
  // minimum for checkout/manual funding.
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: String, enum: FundingStatus, default: FundingStatus.PENDING, index: true })
  status: FundingStatus;

  @Prop({ type: String, default: 'Manual bank deposit' })
  method: string;

  /** Payment gateway used: 'paystack' | 'cashback' | 'manual'. */
  @Prop({
    type: String,
    enum: ['paystack', 'cashback', 'manual'],
    default: 'manual',
    index: true,
  })
  provider: string;

  /** Reference sent to the payment gateway (equals `reference` when Paystack). */
  @Prop({ type: String, sparse: true, index: true })
  paymentReference?: string;

  /** Gateway transaction reference returned at checkout initialisation. */
  @Prop({ type: String })
  transactionReference?: string;

  /** Paystack hosted checkout URL (steps in, awaits payment). */
  @Prop({ type: String })
  checkoutUrl?: string;

  /** Gateway metadata (verification payload, merchant name, …) for audit. */
  @Prop({ type: Object })
  providerMeta?: Record<string, any>;

  /**
   * Transfer reference the user keyed in when creating a `cashback` (bank
   * transfer to the company account) funding request. Lets the admin match the
   * incoming transfer to the request when verifying. Absent for Paystack /
   * manual DVA deposits.
   */
  @Prop({ type: String, trim: true })
  transferReference?: string;

  @Prop()
  adminNote?: string;

  /**
   * Cashback wallet bonus (₦) credited alongside the wallet top-up when a
   * `cashback` provider funding request is approved. Set at credit time from
   * the admin-configured Cashback Funding percentage; absent when the bonus
   * was disabled (0%).
   */
  @Prop({ type: Number })
  cashbackAmount?: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy?: Types.ObjectId;

  @Prop({ type: Date })
  processedAt?: Date;

  /** Set automatically by `timestamps: true`. */
  createdAt?: Date;
  updatedAt?: Date;
}

export const FundingSchema = SchemaFactory.createForClass(Funding);