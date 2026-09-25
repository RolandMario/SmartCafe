import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Wallet } from './schemas/wallet.schema';
import { WalletLedger } from './schemas/wallet-ledger.schema';
import { LedgerType, PaymentWallet } from '../common/enums';
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
    return {
      balance: wallet.balance,
      cashbackBalance: wallet.cashbackBalance ?? 0,
      currency: wallet.currency,
    };
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

  /**
   * Credit a user's cashback wallet (e.g. cashback earned on a successful
   * purchase, or a refund back into a cashback-funded order). Cashback is never
   * withdrawable — it can only be spent as a payment source on future purchases.
   */
  async creditCashback(
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
        { $inc: { cashbackBalance: amount } },
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
          wallet: PaymentWallet.CASHBACK,
          tag: 'CASHBACK_EARNED',
          amount,
          balanceBefore: (wallet.cashbackBalance ?? 0) - amount,
          balanceAfter: wallet.cashbackBalance ?? 0,
          description,
        },
      ],
      { session },
    );
    return wallet;
  }

  /**
   * Debit a user's cashback wallet to pay for a purchase. The balance is
   * decremented conditionally — when the available cashback is insufficient
   * nothing is mutated and a BadRequestException is thrown, so attempt + debit
   * can never leave a negative cashback balance.
   */
  async debitCashback(
    userId: string,
    amount: number,
    description: string,
    transactionId?: string,
    session?: ClientSession,
  ): Promise<any> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const wallet = await this.walletModel
      .findOneAndUpdate(
        { user: this.toObjectId(userId), cashbackBalance: { $gte: amount } },
        { $inc: { cashbackBalance: -amount } },
        { new: true, session },
      )
      .session(session ?? null);
    if (!wallet) {
      throw new BadRequestException('Insufficient cashback balance');
    }
    await this.ledgerModel.create(
      [
        {
          user: this.toObjectId(userId),
          transaction: transactionId ? this.toObjectId(transactionId) : undefined,
          type: LedgerType.DEBIT,
          wallet: PaymentWallet.CASHBACK,
          tag: 'CASHBACK_USED',
          amount,
          balanceBefore: (wallet.cashbackBalance ?? 0) + amount,
          balanceAfter: wallet.cashbackBalance ?? 0,
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