import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ServiceType } from '../../common/enums';

@Schema({ timestamps: true })
export class CatalogItem extends Document {
  @Prop({ type: String, enum: ServiceType, required: true, index: true })
  service: ServiceType;

  /** Network / cable operator / disco / provider key e.g. MTN, DSTV, ikeja-electric */
  @Prop({ required: true, trim: true })
  provider: string;

  @Prop({ required: true, trim: true })
  providerLabel: string;

  /** Product / variation code sent to the vendor */
  @Prop({ required: true, trim: true })
  productCode: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  description?: string;

  /** Fixed selling price (data plans, cable packages, WAEC PIN) */
  @Prop({ type: Number })
  amount?: number;

  @Prop({ type: Number })
  minAmount?: number;

  @Prop({ type: Number })
  maxAmount?: number;

  /** Price per unit for unit-priced services (SMS) */
  @Prop({ type: Number })
  unitPrice?: number;

  /** Vendor's charge per unit (SMS) — used for profit reports when the SMS API exposes no unit price. */
  @Prop({ type: Number })
  providerUnitCost?: number;

  /** Validity period in days (data bundles: 1 = daily, 7 = weekly, 30 = monthly, ...) */
  @Prop({ type: Number })
  validityDays?: number;

  @Prop({ type: Number, default: 0 })
  commission?: number;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export const CatalogItemSchema = SchemaFactory.createForClass(CatalogItem);
CatalogItemSchema.index({ service: 1, provider: 1 });
CatalogItemSchema.index({ service: 1, active: 1, sortOrder: 1 });