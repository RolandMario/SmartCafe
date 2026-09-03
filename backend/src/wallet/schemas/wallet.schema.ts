import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Wallet extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  balance: number;

  @Prop({ default: 'NGN' })
  currency: string;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);