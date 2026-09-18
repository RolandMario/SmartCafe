import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ServiceType } from '../common/enums';
import { CatalogItem } from './schemas/catalog-item.schema';
import { CatalogSyncStatus } from './schemas/catalog-sync-status.schema';
import { DataPlanRow } from './data-plan-sync';

/** Serialised status of a DATA catalog re-seed — shared by VendorService + the admin API. */
export interface DataSyncStatusShape {
  state: 'idle' | 'syncing' | 'done' | 'error';
  source?: 'all' | 'pairgate' | 'vtpass';
  startedAt?: string;
  finishedAt?: string;
  synced?: number;
  removed?: number;
  message?: string;
}

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
    @InjectModel(CatalogSyncStatus.name)
    private statusModel: Model<CatalogSyncStatus>,
  ) {}

  /**
   * Last known DATA catalog sync status. Persisted in Mongo so it survives a
   * process restart / cold start and is the same on every instance — the hosted
   * backend runs on ephemeral serverless instances, so an in-memory-only status
   * would read back as "idle" on the next request even after a successful
   * re-seed.
   */
  async getSyncStatus(): Promise<DataSyncStatusShape> {
    const doc = await this.statusModel.findOne({ service: ServiceType.DATA }).lean();
    if (!doc) return { state: 'idle' };
    const iso = (v: any): string | undefined =>
      v ? new Date(v).toISOString() : undefined;
    return {
      state: doc.state,
      source: doc.source ?? undefined,
      startedAt: iso(doc.startedAt),
      finishedAt: iso(doc.finishedAt),
      synced: doc.synced,
      removed: doc.removed,
      message: doc.message,
    };
  }

  /** Persist a DATA sync status transition (single upserted doc per service). */
  async persistSyncStatus(status: DataSyncStatusShape): Promise<void> {
    await this.statusModel.updateOne(
      { service: ServiceType.DATA },
      {
        $set: {
          service: ServiceType.DATA,
          state: status.state,
          source: status.source ?? null,
          startedAt: status.startedAt ? new Date(status.startedAt) : null,
          finishedAt: status.finishedAt ? new Date(status.finishedAt) : null,
          synced: status.synced ?? 0,
          removed: status.removed ?? 0,
          message: status.message ?? '',
        },
      },
      { upsert: true },
    );
  }

  async replaceDataCatalog(
    rows: DataPlanRow[],
  ): Promise<{ synced: number; removed: number }> {
    // The DATA catalog is a shared multi-vendor list. Group by (provider,
    // vendor) so each plan is upserted once per code and stale codes are pruned
    // ONLY within the same provider+vendor — the other vendors' plans are never
    // touched, so nothing needs to be re-seeded when routing changes.
    const groups = new Map<string, DataPlanRow[]>();
    for (const row of rows) {
      if (!row?.provider || !row?.productCode) continue;
      const key = `${row.provider}\u0000${row.vendor ?? 'static'}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    let synced = 0;
    let removed = 0;
    const ops: any[] = [];

    // Every upsert + prune is batched into a single ordered:false bulkWrite so
    // a several-hundred-plan catalog re-seeds in ONE round trip, instead of one
    // awaited updateOne per plan (which alone could take tens of seconds).
    for (const [key, list] of groups) {
      const [provider, vendor] = key.split('\u0000');

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
          vendor: row.vendor ?? 'static',
          name: row.name,
          amount: row.amount,
          sortOrder: index,
        };
        if (row.validityDays != null) $set.validityDays = row.validityDays;
        if (row.description != null) $set.description = row.description;
        ops.push({
          updateOne: {
            filter: {
              service: ServiceType.DATA,
              provider: row.provider,
              productCode: row.productCode,
              vendor: row.vendor ?? 'static',
            },
            // Never touch `active` on re-seed — the admin's per-plan show/hide
            // switch must survive a plan-list refresh. New plans are shown by
            // default ($setOnInsert).
            update: {
              $set,
              $setOnInsert: { active: true },
            },
            upsert: true,
          },
        });
        synced++;
      }

      ops.push({
        deleteMany: {
          filter: {
            service: ServiceType.DATA,
            provider,
            vendor,
            productCode: { $nin: [...byCode.keys()] },
          },
        },
      });
    }

    if (ops.length > 0) {
      const res = await this.catalogModel.bulkWrite(ops, { ordered: false });
      removed += res.deletedCount ?? 0;
    }

    return { synced, removed };
  }

  /**
   * Shape of the current active DATA catalog, split by vendor — used by the
   * admin Vendors page + dashboard summaries.
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
        { vendor: 1 },
      )
      .lean();
    let pairgate = 0;
    let vtpass = 0;
    for (const item of items) {
      // Rows written before the vendor field existed are VTPass/static plans.
      if (String(item.vendor ?? '').toLowerCase() === 'pairgate') {
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