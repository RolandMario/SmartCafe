import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User } from './schemas/user.schema';
import { Wallet } from '../wallet/schemas/wallet.schema';
import { WalletLedger } from '../wallet/schemas/wallet-ledger.schema';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { Funding } from '../funding/schemas/funding.schema';
import { Role } from '../common/enums';
import { SearchPaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Wallet.name) private walletModel: Model<Wallet>,
    @InjectModel(WalletLedger.name) private ledgerModel: Model<WalletLedger>,
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    @InjectModel(Funding.name) private fundingModel: Model<Funding>,
    @InjectConnection() private connection: Connection,
  ) {}

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

  /**
   * Permanently delete the authenticated user's account and everything linked
   * to it (wallet, wallet ledger, transactions and funding records).
   *
   * On a replica set (production Atlas) the removal runs inside a single atomic
   * multi-document transaction; standalone MongoDB instances used for local
   * development don't support transactions, so they fall back to a best-effort
   * sequential deletion.
   *
   * Refuses to delete while:
   *  - the account is an admin (needed to manage the platform), or
   *  - the wallet still holds a positive balance (deleting would destroy funds).
   */
  async deleteAccount(userId: string): Promise<{ message: string }> {
    const objectId = new Types.ObjectId(userId);
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        await this.removeUserData(objectId, session);
      });
    } catch (err) {
      if (!isTransactionUnsupportedError(err)) throw err;
      await this.removeUserData(objectId);
    } finally {
      await session.endSession();
    }

    return { message: 'Account deleted successfully' };
  }

  /** Shared guard checks + deletion of the user and all referencing documents. */
  private async removeUserData(objectId: Types.ObjectId, session?: ClientSession) {
    const opts = session ? { session } : {};

    const user = await this.userModel.findById(objectId, {}, opts).lean();
    if (!user) throw new NotFoundException('User not found');

    if (user.role === Role.ADMIN) {
      throw new BadRequestException(
        'Admin accounts cannot be deleted. Contact support for help.',
      );
    }

    // Refuse while a balance remains rather than silently destroying funds.
    const wallet = await this.walletModel.findOne({ user: objectId }, {}, opts).lean();
    if (wallet && wallet.balance > 0) {
      throw new BadRequestException(
        'Your wallet still has a balance. Spend it before deleting your account.',
      );
    }

    await this.ledgerModel.deleteMany({ user: objectId }, opts);
    await this.transactionModel.deleteMany({ user: objectId }, opts);
    // Release any funding records this user processed as an admin.
    await this.fundingModel.updateMany(
      { processedBy: objectId },
      { $unset: { processedBy: 1 } },
      opts,
    );
    await this.fundingModel.deleteMany({ user: objectId }, opts);
    await this.walletModel.deleteMany({ user: objectId }, opts);
    await this.userModel.deleteOne({ _id: objectId }, opts);
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

/**
 * True when the driver reports that this MongoDB server cannot run
 * multi-document transactions (i.e. a standalone mongod rather than a
 * replica set / Atlas). On such servers the delete flow falls back to a
 * sequential, un-transacted removal.
 */
function isTransactionUnsupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /transaction numbers are only allowed|transactions are not supported/i.test(
    err.message,
  );
}