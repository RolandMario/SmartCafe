import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ServiceType } from '../../common/enums';

/**
 * Persistent per-service vendor routing policy.
 *
 * Administrators can pin a service (AIRTIME, DATA, CABLE, ...) to a specific
 * vendor provider (mock | vtpass | ebulksms) without restarting the backend.
 * Services without a row fall back to the global `VENDOR_PROVIDER` env var.
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
export class VendorConfig extends Document {
  @Prop({ type: String, enum: Object.values(ServiceType), required: true, unique: true })
  service: ServiceType;

  @Prop({ required: true, lowercase: true, trim: true })
  provider: string;

  /** Admin user id that last changed this routing rule (if known). */
  @Prop({ type: String, default: null })
  updatedBy?: string | null;
}

export const VendorConfigSchema = SchemaFactory.createForClass(VendorConfig);