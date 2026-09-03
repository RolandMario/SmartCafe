import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../../common/enums';

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc: any, ret: Record<string, any>) => {
      delete ret.password;
      delete ret.__v;
      return ret;
    },
  },
})
export class User extends Document {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, unique: true, trim: true })
  phone: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({ type: String, enum: Role, default: Role.USER })
  role: Role;

  @Prop({ default: true })
  isActive: boolean;

  /**
   * 4-digit transaction PIN (bcrypt-hashed). Required to authorise purchases.
   * Hashed and never selected/serialised by default.
   */
  @Prop({ type: String, select: false })
  pin?: string;

  /**
   * Hashed 6-digit password-reset code issued by forgot-password (email
   * verification). Never selected/serialised by default.
   */
  @Prop({ type: String, select: false })
  resetPasswordToken?: string;

  /** Expiry for {@link resetPasswordToken} (defaults to 15 minutes). */
  @Prop({ type: Date, select: false })
  resetPasswordExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);