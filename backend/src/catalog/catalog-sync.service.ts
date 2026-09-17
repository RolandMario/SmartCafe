import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ServiceType } from '../common/enums';
import { CatalogItem } from './schemas/catalog-item.schema';
import { DataPlanRow } from './data-plan-sync';

/**
 * Replaces the entire DATA catalog with a vendor's current plan list (used when
 * the admin routes DATA to a different vendor):
 *   - pairgate  -> upsert Pairgate plans (productCode = pairgate plan_id)
 *   - vtpass    -> upsert VTPass variation plans (productCode = variation_code)
 *   - mock      -> upsert the bundled static DATA seed
 * Rows from the previous vendor that are NOT part of the fresh listing (stale
 * codes AND providers the new vendor doesn't serve) are pruned, so the catalog
 * is never left "mixed" with plans the active provider can't fulfil.
 */
@Injectable()
export class CatalogSyncService {
  constructor(
    @InjectModel(CatalogItem.name) private catalogModel: Model<CatalogItem>,
  ) {}

  async replaceDataCatalog(
    rows: DataPlanRow[],
  ): Promise<{ synced: number; removed: number }> {
    // Group by provider so the fresh listing is upserted once per code and the
    // authoritative code set per provider is known for pruning.
    const byProvider = new Map<string, DataPlanRow[]>();
    for (const row of rows) {
      if (!row?.provider || !row?.productCode) continue;
      const list = byProvider.get(row.provider) ?? [];
      list.push(row);
      byProvider.set(row.provider, list);
    }

    let synced = 0;
    let removed = 0;

    for (const [provider, list] of byProvider) {
      // Each product code maps to exactly one row (last occurrence wins).
      const byCode = new Map<string, DataPlanRow>();
      for (const row of list) byCode.set(row.productCode, row);

      let index = 0;
      for (const row of byCode.values()) {
        index++;
        const $set: Record<string, any> = {
          service: ServiceType.DATA,
          provider: row.provider,
          providerLabel: row.providerLabel,
          productCode: row.productCode,
          name: row.name,
          amount: row.amount,
          sortOrder: index,
          active: true,
        };
        if (row.validityDays != null) $set.validityDays = row.validityDays;
        if (row.description != null) $set.description = row.description;
        await this.catalogModel.updateOne(
          {
            service: ServiceType.DATA,
            provider: row.provider,
            productCode: row.productCode,
          },
          { $set },
          { upsert: true },
        );
        synced++;
      }

      const deleted = await this.catalogModel.deleteMany({
        service: ServiceType.DATA,
        provider,
        productCode: { $nin: [...byCode.keys()] },
      });
      removed += deleted.deletedCount ?? 0;
    }

    // Full replacement: providers that have NO rows in the fresh listing (a
    // network the new vendor doesn't serve, or one whose fetch failed this run)
    // are wiped as well, so the catalog never ends up mixed with plans from the
    // previous vendor. A surviving stale plan would be shown to customers and
    // fail at purchase because the active provider doesn't recognise its code.
    const activeProviders = new Set(byProvider.keys());
    const storedProviders: string[] = await this.catalogModel.distinct('provider', {
      service: ServiceType.DATA,
    });
    for (const provider of storedProviders) {
      if (activeProviders.has(provider)) continue;
      const deleted = await this.catalogModel.deleteMany({
        service: ServiceType.DATA,
        provider,
      });
      removed += deleted.deletedCount ?? 0;
    }

    return { synced, removed };
  }

  /**
   * Shape of the current active DATA catalog, split by vendor source — used by
   * the admin Vendors page to show whether the catalog actually switched.
   */
  async countDataPlans(): Promise<{
    total: number;
    pairgate: number;
    vtpass: number;
    source: 'pairgate' | 'vtpass' | 'mixed' | 'empty';
  }> {
    const items = await this.catalogModel
      .find(
        { service: ServiceType.DATA, active: true },
        { productCode: 1, description: 1 },
      )
      .lean();
    let pairgate = 0;
    let vtpass = 0;
    for (const item of items) {
      const description = String(item.description ?? '');
      const code = String(item.productCode ?? '');
      // Pairgate plans are stored with numeric plan_ids and a "Pairgate <type>"
      // description by the re-seed; everything else is a VTPass/static-seed plan.
      if (description.startsWith('Pairgate ') || /^\d+$/.test(code)) {
        pairgate++;
      } else {
        vtpass++;
      }
    }
    const total = items.length;
    return {
      total,
      pairgate,
      vtpass,
      source:
        total === 0
          ? 'empty'
          : pairgate > 0 && vtpass === 0
            ? 'pairgate'
            : vtpass > 0 && pairgate === 0
              ? 'vtpass'
              : 'mixed',
    };
  }
}