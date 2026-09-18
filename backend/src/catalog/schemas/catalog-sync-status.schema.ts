import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Latest status of a DATA catalog re-seed, persisted in Mongo so it survives
 * process restarts / cold starts (the hosted backend runs on ephemeral
 * serverless instances) and is identical on every instance. One doc per service
 * ('DATA').
 */
@Schema({
  timestamps: true,
  collection: 'catalogsyncstatuses',
  toJSON: {
    virtuals: true,
    transform: (_doc: any, ret: Record<string, any>) => {
      delete ret.__v;
      delete ret._id;
      return ret;
    },
  },
})
export class CatalogSyncStatus extends Document {
  @Prop({ type: String, required: true, unique: true, enum: ['DATA'] })
  service: string;

  @Prop({
    type: String,
    required: true,
    enum: ['idle', 'syncing', 'done', 'error'],
    default: 'idle',
  })
  state: 'idle' | 'syncing' | 'done' | 'error';

  @Prop({ type: String, default: null })
  source?: 'pairgate' | 'vtpass' | null;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt?: Date | null;

  @Prop({ type: Number, default: 0 })
  synced?: number;

  @Prop({ type: Number, default: 0 })
  removed?: number;

  @Prop({ type: String, default: '' })
  message?: string;
}

export const CatalogSyncStatusSchema = SchemaFactory.createForClass(CatalogSyncStatus);