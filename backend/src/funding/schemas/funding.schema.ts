import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { FundingStatus } from '../../common/enums';

@Schema({ timestamps: true })
export class Funding extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 100 })
  amount: number;

  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: String, enum: FundingStatus, default: FundingStatus.PENDING, index: true })
  status: FundingStatus;

  @Prop({ type: String, default: 'Manual bank deposit' })
  method: string;

  /** Payment gateway used: 'monnify' | 'paystack' | 'manual'. */
  @Prop({
    type: String,
    enum: ['monnify', 'paystack', 'manual'],
    default: 'manual',
    index: true,
  })
  provider: string;

  /** Reference sent to the payment gateway (equals `reference` when Monnify). */
  @Prop({ type: String, sparse: true, index: true })
  paymentReference?: string;

  /** Monnify transaction reference returned at checkout initialisation. */
  @Prop({ type: String })
  transactionReference?: string;

  /** Monnify hosted checkout URL (steps in, awaits payment). */
  @Prop({ type: String })
  checkoutUrl?: string;

  /** Gateway metadata (verification payload, merchant name, …) for audit. */
  @Prop({ type: Object })
  providerMeta?: Record<string, any>;

  @Prop()
  adminNote?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy?: Types.ObjectId;

  @Prop({ type: Date })
  processedAt?: Date;
}

export const FundingSchema = SchemaFactory.createForClass(Funding);