import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { LedgerType, PaymentWallet } from '../../common/enums';

@Schema({ timestamps: true })
export class WalletLedger extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Transaction' })
  transaction?: Types.ObjectId;

  @Prop({ type: String, enum: LedgerType, required: true })
  type: LedgerType;

  /** Which wallet this entry hits (main | cashback). */
  @Prop({ type: String, enum: PaymentWallet, default: PaymentWallet.MAIN })
  wallet: PaymentWallet;

  /** Grouping tag, e.g. CASHBACK_EARNED, CASHBACK_USED, REFUND, FUNDING. */
  @Prop({ type: String })
  tag?: string;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: Number, required: true })
  balanceBefore: number;

  @Prop({ type: Number, required: true })
  balanceAfter: number;

  @Prop({ type: String, required: true })
  description: string;
}

export const WalletLedgerSchema = SchemaFactory.createForClass(WalletLedger);
WalletLedgerSchema.index({ user: 1, createdAt: -1 });