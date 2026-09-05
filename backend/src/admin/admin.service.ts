import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Transaction } from '../transactions/schemas/transaction.schema';
import { User } from '../users/schemas/user.schema';
import { VendorService } from '../vendors/vendor.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { QueryTransactionsDto } from '../transactions/dto/transactions.dto';
import { ServiceType } from '../common/enums';

export type ProfitRange = 'today' | '7d' | '30d' | 'all';

/** Services whose products have fixed provider prices (live-margin lookups). */
const PROFIT_MARGIN_SERVICES = [
  ServiceType.DATA,
  ServiceType.CABLE,
  ServiceType.WAEC,
  ServiceType.JAMB,
  ServiceType.SMS,
];

/** Preferred ordering for the realized-profit breakdown (targets first). */
const CATEGORY_ORDER = [
  'DATA',
  'CABLE · DSTV',
  'CABLE · GOTV',
  'CABLE · StarTimes',
  'WAEC',
  'JAMB',
  'SMS',
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rank for the realized/margin category ordering (unlisted categories go last). */
const categoryRank = (category: string) => {
  const idx = CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
};

/** Pretty category label for cable providers (DSTV / GOTV / StarTimes). */
const cableCategory = (provider: string) => {
  const key = String(provider ?? '').toLowerCase();
  if (key === 'dstv') return 'CABLE · DSTV';
  if (key === 'gotv') return 'CABLE · GOTV';
  if (key === 'startimes') return 'CABLE · StarTimes';
  return `CABLE · ${provider}`;
};

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Transaction.name) private txModel: Model<Transaction>,
    @InjectModel(User.name) private userModel: Model<User>,
    private vendorService: VendorService,
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
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

  /**
   * Profit report for the admin dashboard:
   *  - realized profits per service category, computed from the amount each
   *    successful transaction actually cost us (`transaction.providerCost`);
   *  - current live margins per catalog product (sales price vs. the vendor's
   *    current API price) for DATA / CABLE / WAEC / JAMB / SMS.
   */
  async profits(rawRange?: string) {
    const range: ProfitRange =
      rawRange === 'today' || rawRange === '7d' || rawRange === '30d' || rawRange === 'all'
        ? rawRange
        : 'all';

    const now = new Date();
    let since: Date | null = null;
    if (range === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === '7d') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const match: Record<string, any> = { status: 'success' };
    if (since) match.createdAt = { $gte: since };

    const [rows, recent, margins] = await Promise.all([
      this.txModel.aggregate([
        { $match: match },
        {
          $project: {
            service: 1,
            amount: 1,
            providerCost: 1,
            category: {
              $cond: [
                { $eq: ['$service', 'CABLE'] },
                {
                  $switch: {
                    branches: [
                      {
                        case: { $eq: [{ $toLower: { $ifNull: ['$meta.provider', ''] } }, 'dstv'] },
                        then: 'CABLE · DSTV',
                      },
                      {
                        case: { $eq: [{ $toLower: { $ifNull: ['$meta.provider', ''] } }, 'gotv'] },
                        then: 'CABLE · GOTV',
                      },
                      {
                        case: {
                          $eq: [{ $toLower: { $ifNull: ['$meta.provider', ''] } }, 'startimes'],
                        },
                        then: 'CABLE · StarTimes',
                      },
                    ],
                    default: {
                      $concat: ['CABLE · ', { $toString: { $ifNull: ['$meta.provider', 'UNKNOWN'] } }],
                    },
                  },
                },
                '$service',
              ],
            },
          },
        },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            sales: { $sum: '$amount' },
            providerCost: { $sum: { $ifNull: ['$providerCost', 0] } },
            measured: { $sum: { $cond: [{ $ne: ['$providerCost', null] }, 1, 0] } },
          },
        },
      ]),
      this.txModel
        .find(match)
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('user', 'name email phone'),
      this.buildMargins(),
    ]);

    const byCategory = rows
      .map((row: any) => {
        const profit = row.sales - row.providerCost;
        return {
          category: row._id,
          count: row.count,
          sales: round2(row.sales),
          providerCost: round2(row.providerCost),
          profit: round2(profit),
          margin: row.sales > 0 ? round2((profit / row.sales) * 100) : 0,
          measured: row.measured,
        };
      })
      .sort(
        (a: any, b: any) => categoryRank(a.category) - categoryRank(b.category) || b.sales - a.sales,
      );

    const totals = byCategory.reduce(
      (acc: any, c: any) => ({
        sales: acc.sales + c.sales,
        providerCost: acc.providerCost + c.providerCost,
        profit: acc.profit + c.profit,
        measuredCount: acc.measuredCount + c.measured,
        unmeasuredCount: acc.unmeasuredCount + (c.count - c.measured),
      }),
      { sales: 0, providerCost: 0, profit: 0, measuredCount: 0, unmeasuredCount: 0 },
    );

    return {
      range,
      since: since?.toISOString() ?? null,
      totals: {
        sales: round2(totals.sales),
        providerCost: round2(totals.providerCost),
        profit: round2(totals.profit),
        measuredCount: totals.measuredCount,
        unmeasuredCount: totals.unmeasuredCount,
        margin: totals.sales > 0 ? round2((totals.profit / totals.sales) * 100) : 0,
      },
      byCategory,
      margins,
      recent,
    };
  }

  /**
   * Current per-product live margins: sales price (admin set) minus the vendor's
   * current API price (VTPass service-variations / mock simulation / SMS admin rate).
   */
  private async buildMargins() {
    const items = await this.catalogService.adminList({});
    const wanted = items.filter(
      (i) => i.active && PROFIT_MARGIN_SERVICES.includes(i.service),
    );
    const grouped = new Map<string, { category: string; items: any[] }>();

    for (const item of wanted) {
      const category =
        item.service === ServiceType.CABLE ? cableCategory(item.provider) : item.service;
      if (!grouped.has(category)) {
        grouped.set(category, { category, items: [] });
      }
      const group = grouped.get(category)!;

      let salesPrice: number | null = null;
      let providerPrice: number | null = null;

      if (item.service === ServiceType.SMS) {
        salesPrice = item.unitPrice ?? null;
        // SMS venders report no per-message price, so the admin-set provider
        // unit cost is the source of truth for the SMS margin.
        providerPrice = item.providerUnitCost ?? null;
      } else {
        salesPrice = item.amount ?? null;
        if (salesPrice != null) {
          providerPrice = await this.vendorService.getProviderPrice({
            serviceType: item.service,
            productCode: item.productCode,
            amount: item.amount,
          });
        }
      }

      group.items.push({
        productId: item._id.toString(),
        name: item.name,
        productCode: item.productCode,
        salesPrice,
        providerPrice,
        margin:
          salesPrice != null && providerPrice != null ? round2(salesPrice - providerPrice) : null,
      });
    }

    return [...grouped.values()]
      .map((g) => {
        const covered = g.items.filter(
          (i: any) => i.salesPrice != null && i.providerPrice != null,
        );
        const salesTotal = round2(covered.reduce((s: number, i: any) => s + i.salesPrice, 0));
        const providerTotal = round2(
          covered.reduce((s: number, i: any) => s + i.providerPrice, 0),
        );
        return {
          category: g.category,
          covered: covered.length,
          total: g.items.length,
          items: g.items,
          salesTotal,
          providerTotal,
          profitTotal: round2(salesTotal - providerTotal),
        };
      })
      .sort((a: any, b: any) => categoryRank(a.category) - categoryRank(b.category));
  }
}