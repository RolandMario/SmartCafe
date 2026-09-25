import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { PaymentWallet, ServiceType, TransactionStatus } from '../../common/enums';

@Schema({ timestamps: true })
export class Transaction extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: ServiceType, required: true, index: true })
  service: ServiceType;

  /** Human-friendly unique reference shown to the user */
  @Prop({ required: true, unique: true })
  reference: string;

  /** Idempotency key forwarded to the vendor */
  @Prop({ required: true, unique: true, index: true })
  requestId: string;

  @Prop({ type: Number, required: true })
  amount: number;

  /** The amount the vendor provider actually charged for this order (sales price − profit). */
  @Prop({ type: Number })
  providerCost?: number;

  @Prop({ type: Number, default: 0 })
  commission: number;

  /** Which wallet funded the purchase ('main' default | 'cashback'). */
  @Prop({ type: String, enum: PaymentWallet, default: PaymentWallet.MAIN })
  paymentWallet: PaymentWallet;

  /**
   * Cashback the user stands to earn (always >= 0) when this purchase settles
   * as successful — captured from the catalog item's admin-set commission.
   * 0 means the product earns no cashback.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  cashback: number;

  /**
   * Idempotency guard: true once the cashback has been credited, so settlement
   * never grants it twice even if requery races.
   */
  @Prop({ type: Boolean, default: false })
  cashbackCredited: boolean;

  @Prop({ type: String, enum: TransactionStatus, default: TransactionStatus.PENDING, index: true })
  status: TransactionStatus;

  /** Inputs for this order (phone, smart card no, plan, disco, ...) */
  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  /** Result returned by the vendor (token, PIN, serial, customer name, ...) */
  @Prop({ type: Object, default: {} })
  providerMeta: Record<string, any>;

  @Prop()
  vendorReference?: string;

  @Prop()
  failureReason?: string;

  @Prop({ type: Date })
  settledAt?: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ service: 1, status: 1, createdAt: -1 });