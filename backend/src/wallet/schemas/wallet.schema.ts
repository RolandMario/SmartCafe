import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Wallet extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  balance: number;

  /**
   * Cashback earned on successful purchases. Never withdrawable — it can only
   * be spent as a payment source on future purchases.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  cashbackBalance: number;

  @Prop({ default: 'NGN' })
  currency: string;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);