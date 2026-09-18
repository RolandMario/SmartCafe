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
export type DataPlanRange = '7d' | '30d' | '90d' | 'all';

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

  /**
   * Data plan purchase trends over time (successful DATA transactions only):
   *  - `series` — one bucket per day (or per month for `all`) with a per-plan
   *    count + revenue breakdown;
   *  - `plans`  — per-plan totals across the period, sorted by purchase count;
   *  - `totals` — combined count + revenue for the period.
   * Lets admins see which bundles people buy most (count) and which generate
   * the most revenue (price), and how that changes over time.
   */
  async dataPlanSales(rawRange?: string) {
    const range: DataPlanRange =
      rawRange === '7d' || rawRange === '30d' || rawRange === '90d' || rawRange === 'all'
        ? rawRange
        : '30d';

    const now = new Date();
    let since: Date | null = null;
    if (range === '7d') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (range === '90d') {
      since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const match: Record<string, any> = { service: ServiceType.DATA, status: 'success' };
    if (since) match.createdAt = { $gte: since };

    // Daily buckets for short ranges, monthly for "all time" (keeps the chart readable).
    const bucketFormat = range === 'all' ? '%Y-%m' : '%Y-%m-%d';

    type PlanRow = {
      bucket: string;
      key: string;
      network: string;
      plan: string;
      count: number;
      revenue: number;
    };
    const rows: PlanRow[] = await this.txModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            bucket: {
              $dateToString: { format: bucketFormat, date: '$createdAt', timezone: 'Africa/Lagos' },
            },
            // Stable plan identity (survives catalog re-seeds); falls back to
            // the plan name and finally to 'unknown' for very old records.
            key: { $ifNull: ['$meta.productCode', '$meta.plan', 'unknown'] },
          },
          network: { $first: { $toString: { $ifNull: ['$meta.providerLabel', ''] } } },
          plan: { $first: { $toString: { $ifNull: ['$meta.plan', ''] } } },
          count: { $sum: 1 },
          revenue: { $sum: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id.bucket',
          key: '$_id.key',
          network: 1,
          plan: 1,
          count: 1,
          revenue: 1,
        },
      },
    ]);

    const planTotals = new Map<string, { key: string; label: string; count: number; revenue: number }>();
    const seriesMap = new Map<
      string,
      { bucket: string; count: number; revenue: number; plans: Record<string, { count: number; revenue: number }> }
    >();
    const trim = (s: string) => (s.trim() ? s : null);

    for (const row of rows) {
      const label = [trim(row.network), trim(row.plan)].filter(Boolean).join(' · ') || row.key;
      const plan = planTotals.get(row.key) ?? { key: row.key, label, count: 0, revenue: 0 };
      plan.count += row.count;
      plan.revenue += row.revenue;
      planTotals.set(row.key, plan);

      const point = seriesMap.get(row.bucket) ?? { bucket: row.bucket, count: 0, revenue: 0, plans: {} };
      point.count += row.count;
      point.revenue += row.revenue;
      point.plans[row.key] = { count: row.count, revenue: row.revenue };
      seriesMap.set(row.bucket, point);
    }

    const plans = [...planTotals.values()]
      .map((p) => ({ ...p, revenue: round2(p.revenue) }))
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue);

    const series = [...seriesMap.values()]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((p) => ({ ...p, revenue: round2(p.revenue) }));

    const totals = series.reduce(
      (acc, p) => ({ count: acc.count + p.count, revenue: acc.revenue + p.revenue }),
      { count: 0, revenue: 0 },
    );

    return {
      range,
      since: since?.toISOString() ?? null,
      totals: { ...totals, revenue: round2(totals.revenue) },
      series,
      plans,
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
            // Platform commission earned per successful transaction (admin profit):
            // AIRTIME 3%, DATA 3%, ELECTRICITY 1%, CABLE 1.5% of amount,
            // WAEC ₦150 flat, everything else (SMS, JAMB, ...) 0.
            commission: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$service', 'AIRTIME'] },
                    then: { $multiply: ['$amount', 0.03] },
                  },
                  {
                    case: { $eq: ['$service', 'DATA'] },
                    then: { $multiply: ['$amount', 0.03] },
                  },
                  {
                    case: { $eq: ['$service', 'ELECTRICITY'] },
                    then: { $multiply: ['$amount', 0.01] },
                  },
                  {
                    case: { $eq: ['$service', 'CABLE'] },
                    then: { $multiply: ['$amount', 0.015] },
                  },
                  { case: { $eq: ['$service', 'WAEC'] }, then: 150 },
                ],
                default: 0,
              },
            },
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
            commission: { $sum: '$commission' },
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
          commission: round2(row.commission),
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
        commission: acc.commission + c.commission,
        profit: acc.profit + c.profit,
        measuredCount: acc.measuredCount + c.measured,
        unmeasuredCount: acc.unmeasuredCount + (c.count - c.measured),
      }),
      {
        sales: 0,
        providerCost: 0,
        commission: 0,
        profit: 0,
        measuredCount: 0,
        unmeasuredCount: 0,
      },
    );

    return {
      range,
      since: since?.toISOString() ?? null,
      totals: {
        sales: round2(totals.sales),
        providerCost: round2(totals.providerCost),
        commission: round2(totals.commission),
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
    const { items } = await this.catalogService.adminList({ perPage: 500 });
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
            vendor: item.vendor ?? undefined,
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