import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ServiceType } from '../common/enums';
import { CatalogItem } from './schemas/catalog-item.schema';
import { CatalogSyncStatus } from './schemas/catalog-sync-status.schema';
import { DataPlanRow } from './data-plan-sync';
import { CablePlanRow } from './cable-plan-sync';

/** Serialised status of a catalog re-seed — shared by VendorService + the admin API. */
export interface CatalogSyncStatusShape {
  state: 'idle' | 'syncing' | 'done' | 'error';
  source?: 'all' | 'pairgate' | 'vtpass';
  startedAt?: string;
  finishedAt?: string;
  synced?: number;
  removed?: number;
  message?: string;
}

/** Backwards-compatible alias — the status shape is no longer DATA-only. */
export type DataSyncStatusShape = CatalogSyncStatusShape;

/** Vendors whose rows a VTPass re-sync owns — everything else is never pruned. */
const SYNC_OWNED_VENDORS = new Set(['vtpass', 'static']);

/** Outcome of one provider's plan re-sync (also used for the CLI dry run). */
export interface ProviderPlanSyncResult {
  /** Codes that did not exist in the catalog yet. */
  inserted: number;
  /** Codes that already existed and were updated in place. */
  updated: number;
  /** Stale + duplicate rows deleted (0 on a dry run). */
  removed: number;
  insertedCodes: string[];
  updatedCodes: string[];
  removedCodes: string[];
  /** Codes that had more than one row (the oldest row is kept). */
  duplicateCodes: string[];
}

/** Shape of the CABLE catalog, split by provider — admin Vendors page summary. */
export interface CableCatalogInfo {
  total: number;
  dstv: number;
  gotv: number;
  startimes: number;
  other: number;
  source: 'vtpass' | 'static' | 'mixed' | 'empty';
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
   * Last known catalog sync status for a service. Persisted in Mongo so it
   * survives a process restart / cold start and is the same on every instance —
   * the hosted backend runs on ephemeral serverless instances, so an
   * in-memory-only status would read back as "idle" on the next request even
   * after a successful re-seed.
   */
  async getSyncStatus(
    service: string = ServiceType.DATA,
  ): Promise<CatalogSyncStatusShape> {
    const doc = await this.statusModel.findOne({ service }).lean();
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

  /** Persist a sync status transition (single upserted doc per service). */
  async persistSyncStatus(
    status: CatalogSyncStatusShape,
    service: string = ServiceType.DATA,
  ): Promise<void> {
    await this.statusModel.updateOne(
      { service },
      {
        $set: {
          service,
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
    peyflex: number;
    source: 'pairgate' | 'vtpass' | 'peyflex' | 'mixed' | 'empty';
  }> {
    const items = await this.catalogModel
      .find(
        { service: ServiceType.DATA, active: true },
        { vendor: 1 },
      )
      .lean();
    let pairgate = 0;
    let vtpass = 0;
    let peyflex = 0;
    for (const item of items) {
      // Rows written before the vendor field existed are VTPass/static plans.
      switch (String(item.vendor ?? '').toLowerCase()) {
        case 'pairgate':
          pairgate++;
          break;
        case 'peyflex':
          peyflex++;
          break;
        default:
          vtpass++;
      }
    }
    const total = items.length;
    return {
      total,
      pairgate,
      vtpass,
      peyflex,
      source:
        total === 0
          ? 'empty'
          : pairgate > 0 && vtpass === 0 && peyflex === 0
            ? 'pairgate'
            : vtpass > 0 && pairgate === 0 && peyflex === 0
              ? 'vtpass'
              : peyflex > 0 && pairgate === 0 && vtpass === 0
                ? 'peyflex'
                : 'mixed',
    };
  }

  /**
   * Re-sync ONE provider's plans for a service from a vendor listing (used by
   * the CABLE bouquet refresh and the `sync:vtpass` CLI):
   *
   *   - upsert keyed on `{service, provider, productCode}` — the variation code
   *     stays the stable identity, so an existing row (with its commission,
   *     resellerCommission and any historic order references) is updated in
   *     place instead of being deleted and re-created;
   *   - `active` is only ever set on insert, so the admin's per-plan show/hide
   *     switch survives a refresh;
   *   - stale codes and duplicate rows are pruned ONLY when their vendor is
   *     `vtpass`/`static` (or unset, i.e. written before the vendor field
   *     existed). Rows owned by Pairgate/Peyflex are never touched — this
   *     collection is shared by every data vendor.
   *
   * `dryRun` reports the diff without writing anything; an empty listing is a
   * no-op (a failed vendor response must never wipe a catalogue).
   */
  async syncProviderPlans(
    service: ServiceType,
    provider: string,
    rows: (CablePlanRow | DataPlanRow)[],
    options: { dryRun?: boolean; vendor?: 'vtpass' | 'static' } = {},
  ): Promise<ProviderPlanSyncResult> {
    const vendor = options.vendor ?? 'vtpass';
    const result: ProviderPlanSyncResult = {
      inserted: 0,
      updated: 0,
      removed: 0,
      insertedCodes: [],
      updatedCodes: [],
      removedCodes: [],
      duplicateCodes: [],
    };

    // Each product code maps to exactly one row (last occurrence wins); a row
    // without a code can never be paid for, so it is dropped.
    const byCode = new Map<string, CablePlanRow | DataPlanRow>();
    for (const row of rows) {
      const code = String(row?.productCode ?? '').trim();
      if (!code) continue;
      byCode.set(code, row);
    }
    if (byCode.size === 0) return result;

    const existing = await this.catalogModel
      .find(
        { service, provider },
        { productCode: 1, vendor: 1, createdAt: 1, active: 1 },
      )
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    // (provider, productCode) must be unique. Keep the OLDEST row for a code —
    // it carries the commission history and any order/audit references — and
    // drop the later copies. A code also stays VISIBLE when any of its duplicate
    // rows was visible, so collapsing a hidden legacy row with a visible VTPass
    // row never hides a plan customers could buy before the re-sync. Other
    // vendors' rows are not ours to delete.
    const keeperByCode = new Map<string, any>();
    const visibleByCode = new Map<string, boolean>();
    const duplicateIds: any[] = [];
    for (const doc of existing) {
      const owned =
        SYNC_OWNED_VENDORS.has(String(doc.vendor ?? '').toLowerCase()) || !doc.vendor;
      if (!owned) continue;
      const code = String(doc.productCode ?? '').trim();
      const visible = (doc as any).active !== false;
      if (keeperByCode.has(code)) {
        duplicateIds.push(doc._id);
        result.duplicateCodes.push(code);
        if (visible) visibleByCode.set(code, true);
        continue;
      }
      keeperByCode.set(code, doc);
      visibleByCode.set(code, visible);
    }

    const staleIds: any[] = [];
    for (const [code, doc] of keeperByCode) {
      if (!byCode.has(code)) {
        staleIds.push(doc._id);
        result.removedCodes.push(code);
      }
    }

    for (const code of byCode.keys()) {
      if (keeperByCode.has(code)) {
        result.updated += 1;
        result.updatedCodes.push(code);
      } else {
        result.inserted += 1;
        result.insertedCodes.push(code);
      }
    }
    result.removed = staleIds.length + duplicateIds.length;

    if (options.dryRun) return result;

    const ops: any[] = [];
    let index = 0;
    for (const row of byCode.values()) {
      index += 1;
      const productCode = String(row.productCode).trim();
      const $set: Record<string, any> = {
        service,
        provider,
        providerLabel: row.providerLabel,
        productCode,
        vendor,
        name: row.name,
        amount: row.amount,
        sortOrder: index,
      };
      const dataRow = row as DataPlanRow;
      if (dataRow.validityDays != null) $set.validityDays = dataRow.validityDays;
      if (row.description != null) $set.description = row.description;
      // Keep a plan visible when any of its merged duplicate rows was visible —
      // but never un-hide one the admin deliberately hid.
      const mergedVisible = visibleByCode.get(productCode);
      if (keeperByCode.has(productCode) && mergedVisible) $set.active = true;
      const update: Record<string, any> = { $set };
      if ($set.active === undefined) update.$setOnInsert = { active: true };
      ops.push({
        updateOne: {
          filter: { service, provider, productCode },
          update,
          upsert: true,
        },
      });
    }
    // Prune after the upserts so a re-published code is never caught in between.
    const deleteIds = [...staleIds, ...duplicateIds];
    if (deleteIds.length > 0) {
      ops.push({ deleteMany: { filter: { _id: { $in: deleteIds } } } });
    }

    await this.catalogModel.bulkWrite(ops, { ordered: false });
    return result;
  }

  /**
   * Shape of the active CABLE catalog, split by provider — shown on the admin
   * Vendors page next to the "Re-sync CABLE bouquets" button.
   */
  async countCablePlans(): Promise<CableCatalogInfo> {
    const items = await this.catalogModel
      .find(
        { service: ServiceType.CABLE, active: true },
        { provider: 1, vendor: 1 },
      )
      .lean();
    let dstv = 0;
    let gotv = 0;
    let startimes = 0;
    let other = 0;
    let vtpass = 0;
    for (const item of items) {
      switch (String(item.provider ?? '').toUpperCase()) {
        case 'DSTV':
          dstv += 1;
          break;
        case 'GOTV':
          gotv += 1;
          break;
        case 'STARTIMES':
          startimes += 1;
          break;
        default:
          other += 1;
      }
      if (String(item.vendor ?? '').toLowerCase() === 'vtpass') vtpass += 1;
    }
    const total = items.length;
    return {
      total,
      dstv,
      gotv,
      startimes,
      other,
      source:
        total === 0
          ? 'empty'
          : vtpass === total
            ? 'vtpass'
            : vtpass === 0
              ? 'static'
              : 'mixed',
    };
  }
}