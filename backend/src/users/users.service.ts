import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User } from './schemas/user.schema';
import { SearchPaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async findById(id: string): Promise<User> {
    const user = await this.userModel.findById(id);
    return user as User;
  }

  async getPinStatus(userId: string): Promise<{ hasPin: boolean }> {
    const user = await this.userModel.findById(userId).select('+pin');
    return { hasPin: Boolean(user?.pin) };
  }

  /** Set a new / change the existing 4-digit transaction PIN. */
  async setPin(
    userId: string,
    pin: string,
    currentPin?: string,
  ): Promise<{ hasPin: boolean }> {
    const user = await this.userModel.findById(userId).select('+pin');
    if (!user) throw new NotFoundException('User not found');

    if (user.pin) {
      if (!currentPin) {
        throw new BadRequestException('Enter your current PIN to change it');
      }
      if (!(await bcrypt.compare(currentPin, user.pin))) {
        throw new UnauthorizedException('Current transaction PIN is incorrect');
      }
    }

    user.pin = await bcrypt.hash(pin, 10);
    await user.save();
    return { hasPin: true };
  }

  /** Verify a submitted 4-digit transaction PIN against the stored hash. */
  async verifyPin(userId: string, pin: string): Promise<boolean> {
    const user = await this.userModel.findById(userId).select('+pin');
    if (!user?.pin) return false;
    return bcrypt.compare(pin, user.pin);
  }

  async updateProfile(userId: string, data: { name?: string; phone?: string }) {
    if (data.phone) {
      const clash = await this.userModel
        .findOne({ phone: data.phone, _id: { $ne: userId } })
        .lean();
      if (clash) {
        throw new NotFoundException('Phone number is already in use');
      }
    }
    const user = await this.userModel.findByIdAndUpdate(userId, data, { new: true });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async adminList(query: SearchPaginationDto) {
    const filter: Record<string, any> = {};
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }
    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.userModel.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async adminUpdate(userId: string, data: { isActive?: boolean; role?: string }) {
    const user = await this.userModel.findByIdAndUpdate(userId, data, { new: true });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}