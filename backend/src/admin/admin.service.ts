import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { User } from '../users/schemas/user.schema';
import { VendorService } from '../vendors/vendor.service';
import { TransactionsService } from '../transactions/transactions.service';
import { QueryTransactionsDto } from '../transactions/dto/transactions.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(User.name) private userModel: Model<User>,
    private vendorService: VendorService,
    private transactionsService: TransactionsService,
  ) {}

  async dashboard() {
    const [totals, byService, recent, userCount, pendingCount, failedCount, successCount] =
      await Promise.all([
        this.txModel.aggregate([
          { $match: { status: 'success' } },
          {
            $group: {
              _id: null,
              volume: { $sum: '$amount' },
              commission: { $sum: '$commission' },
              count: { $sum: 1 },
            },
          },
        ]),
        this.txModel.aggregate([
          { $match: { status: 'success' } },
          {
            $group: {
              _id: '$service',
              count: { $sum: 1 },
              volume: { $sum: '$amount' },
            },
          },
          { $sort: { count: -1 } },
        ]),
        this.txModel
          .find()
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('user', 'name email phone'),
        this.userModel.countDocuments(),
        this.txModel.countDocuments({ status: 'pending' }),
        this.txModel.countDocuments({ status: 'failed' }),
        this.txModel.countDocuments({ status: 'success' }),
      ]);

    return {
      totalUsers: userCount,
      totals: totals[0] ?? { volume: 0, commission: 0, count: 0 },
      byService,
      counts: { pending: pendingCount, failed: failedCount, success: successCount },
      recent,
      vendorProvider: this.vendorService.getProviderName(),
      vendorConfigs: this.vendorService.getEffectiveConfig(),
    };
  }

  async transactions(query: QueryTransactionsDto) {
    const filter: Record<string, any> = {};
    if (query.service) filter.service = query.service;
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.txModel
        .find(filter)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.txModel.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async transactionDetail(id: string) {
    const txn = await this.txModel.findById(id).populate('user', 'name email phone');
    if (!txn) throw new NotFoundException('Transaction not found');
    return txn;
  }

  async requeryTransaction(id: string) {
    const txn = await this.txModel.findById(id);
    if (!txn) throw new NotFoundException('Transaction not found');
    return this.transactionsService.requery(id);
  }

  async vendorBalance() {
    return this.vendorService.getBalances();
  }
}