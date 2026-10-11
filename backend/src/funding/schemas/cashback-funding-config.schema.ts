import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Persistent, admin-editable Cashback Funding bonus rate.
 *
 * When a user funds their wallet through the **Cashback Funding** option (a
 * manual bank transfer to the company account), this percentage of the funded
 * amount is additionally credited to their cashback wallet when an admin
 * approves the request.
 *
 * The collection holds a single document (singleton). A percentage of 0
 * disables the bonus, so deployments that never set it keep today's behavior.
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
export class CashbackFundingConfig extends Document {
  /** Bonus percentage 0–100 of the funded amount credited to the cashback wallet. */
  @Prop({ type: Number, required: true, default: 0, min: 0, max: 100 })
  percentage: number;

  /** Admin user id that last changed this setting (if known). */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const CashbackFundingConfigSchema = SchemaFactory.createForClass(
  CashbackFundingConfig,
);