import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Wallet } from './schemas/wallet.schema';
import { WalletLedger } from './schemas/wallet-ledger.schema';
import { LedgerType } from '../common/enums';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ClientSession } from 'mongoose';

@Injectable()
export class WalletService {
  constructor(
    @InjectModel(Wallet.name) private walletModel: Model<Wallet>,
    @InjectModel(WalletLedger.name) private ledgerModel: Model<WalletLedger>,
    @InjectConnection() private connection: Connection,
  ) {}

  toObjectId(id: string) {
    return new Types.ObjectId(id);
  }

  async createWallet(userId: string): Promise<any> {
    const wallet = await this.walletModel.create({ user: this.toObjectId(userId) });
    return wallet;
  }

  async findWallet(userId: string): Promise<any> {
    let wallet = await this.walletModel.findOne({ user: this.toObjectId(userId) });
    if (!wallet) {
      wallet = await this.createWallet(userId);
    }
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.findWallet(userId);
    return { balance: wallet.balance, currency: wallet.currency };
  }

  async debit(
    userId: string,
    amount: number,
    description: string,
    transactionId?: string,
    session?: ClientSession,
  ): Promise<any> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const wallet = await this.walletModel
      .findOneAndUpdate(
        { user: this.toObjectId(userId), balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { new: true, session },
      )
      .session(session ?? null);
    if (!wallet) {
      throw new BadRequestException('Insufficient wallet balance');
    }
    await this.ledgerModel.create(
      [
        {
          user: this.toObjectId(userId),
          transaction: transactionId ? this.toObjectId(transactionId) : undefined,
          type: LedgerType.DEBIT,
          amount,
          balanceBefore: wallet.balance + amount,
          balanceAfter: wallet.balance,
          description,
        },
      ],
      { session },
    );
    return wallet;
  }

  async credit(
    userId: string,
    amount: number,
    description: string,
    transactionId?: string,
    session?: ClientSession,
  ): Promise<any> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const wallet = await this.walletModel
      .findOneAndUpdate(
        { user: this.toObjectId(userId) },
        { $inc: { balance: amount } },
        { new: true, session },
      )
      .session(session ?? null);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    await this.ledgerModel.create(
      [
        {
          user: wallet.user,
          transaction: transactionId ? this.toObjectId(transactionId) : undefined,
          type: LedgerType.CREDIT,
          amount,
          balanceBefore: wallet.balance - amount,
          balanceAfter: wallet.balance,
          description,
        },
      ],
      { session },
    );
    return wallet;
  }

  async ledger(userId: string, query: PaginationDto) {
    const [items, total] = await Promise.all([
      this.ledgerModel
        .find({ user: this.toObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.ledgerModel.countDocuments({ user: this.toObjectId(userId) }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}