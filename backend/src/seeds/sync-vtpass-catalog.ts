import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import { ServiceType } from '../common/enums';
import { CatalogItem, CatalogItemSchema } from '../catalog/schemas/catalog-item.schema';
import {
  CatalogSyncStatus,
  CatalogSyncStatusSchema,
} from '../catalog/schemas/catalog-sync-status.schema';
import { CatalogSyncService, ProviderPlanSyncResult } from '../catalog/catalog-sync.service';
import {
  CABLE_SERVICES,
  CablePlanRow,
  cleanCablePlanName,
} from '../catalog/cable-plan-sync';
import {
  DATA_SERVICES,
  DataPlanRow,
  cleanDataPlanName,
  dataValidityDays,
} from '../catalog/data-plan-sync';

/**
 * Re-sync the CABLE (and DATA) catalog with VTPass's LIVE variation lists.
 *
 *   npm run sync:vtpass                       # dry run — prints the diff
 *   npm run sync:vtpass -- --apply            # writes the catalog
 *   npm run sync:vtpass -- --service=CABLE    # one service only
 *   npm run sync:vtpass -- --provider=GOTV    # one provider only
 *
 * A dry run only reads: it reports the plans that would be inserted, updated
 * and pruned. `--apply` uses the same code path as the admin's "Re-sync CABLE
 * bouquets" button (`CatalogSyncService.syncProviderPlans`), so a CLI apply and
 * an admin refresh always produce the same catalog.
 *
 * Upsert key is `{service, provider, productCode}` — the variation code stays the
 * identity of a plan, so existing rows keep their commission / reseller
 * commission / active flag and historic orders keep pointing at real rows.
 */

const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/vtu';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};
const serviceFilter = flag('service')?.toUpperCase();
const providerFilter = flag('provider')?.toUpperCase();

/** VTPass serves its API under /api; a bare host 302-redirect-loops. */
function endpointBase(): string {
  const host = (process.env.VTPASS_BASE_URL ?? '').replace(/\/+$/, '');
  if (!host) return '';
  return /\/api$/i.test(host) ? host : `${host}/api`;
}

interface LiveVariation {
  code: string;
  name: string;
  amount: number;
  index: number;
}

/** GET /service-variations?serviceID=… → deduped (last occurrence wins) list. */
async function fetchVariations(serviceID: string): Promise<LiveVariation[]> {
  const baseUrl = endpointBase();
  const apiKey = process.env.VTPASS_API_KEY ?? '';
  const publicKey = process.env.VTPASS_PUBLIC_KEY ?? '';
  const { data } = await axios.get(`${baseUrl}/service-variations`, {
    params: { serviceID },
    headers: { 'api-key': apiKey, 'public-key': publicKey },
    timeout: 30000,
  });
  const variations: Array<Record<string, any>> = data?.content?.variations ?? [];
  const plans = new Map<string, LiveVariation>();
  variations.forEach((variation, index) => {
    const code = String(variation?.variation_code ?? '').trim();
    const rawName = String(variation?.variation_name ?? variation?.name ?? '').trim();
    const amount = Number(variation?.variation_amount ?? NaN);
    if (!code || !rawName || !Number.isFinite(amount) || amount <= 0) return;
    plans.set(code, { code, name: rawName, amount, index });
  });
  return [...plans.values()];
}

function money(amount: number): string {
  return `N${amount.toLocaleString('en-US')}`;
}

/** Vendors whose rows a VTPass re-sync owns (mirrors CatalogSyncService). */
function isOwnedVendor(vendor?: string): boolean {
  const key = String(vendor ?? '').toLowerCase();
  return !key || key === 'vtpass' || key === 'static';
}

function table(rows: string[][], headers: string[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

interface Target {
  service: ServiceType;
  provider: string;
  providerLabel: string;
  serviceID: string;
  rows: (DataPlanRow | CablePlanRow)[];
}

function selectedServices(): ServiceType[] {
  if (!serviceFilter) return [ServiceType.DATA, ServiceType.CABLE];
  if (serviceFilter !== 'DATA' && serviceFilter !== 'CABLE') {
    throw new Error(`Unknown --service=${serviceFilter} (expected DATA or CABLE)`);
  }
  return [serviceFilter === 'CABLE' ? ServiceType.CABLE : ServiceType.DATA];
}

/** Fetch one provider's live list and normalise it into catalog rows. */
async function buildTarget(
  service: ServiceType,
  svc: { serviceID: string; provider: string; providerLabel: string },
): Promise<Target> {
  const variations = await fetchVariations(svc.serviceID);
  const rows: (DataPlanRow | CablePlanRow)[] = [];
  for (const variation of variations) {
    if (service === ServiceType.CABLE) {
      const name = cleanCablePlanName(variation.name);
      rows.push({
        provider: svc.provider,
        providerLabel: svc.providerLabel,
        productCode: variation.code,
        vendor: 'vtpass',
        name,
        amount: variation.amount,
        description: '',
      });
      continue;
    }
    const name = cleanDataPlanName(variation.name);
    rows.push({
      provider: svc.provider,
      providerLabel: svc.providerLabel,
      productCode: variation.code,
      vendor: 'vtpass',
      name,
      amount: variation.amount,
      validityDays: dataValidityDays(name, variation.code) ?? 30,
      description: '',
    });
  }
  return {
    service,
    provider: svc.provider,
    providerLabel: svc.providerLabel,
    serviceID: svc.serviceID,
    rows,
  };
}

interface Summary {
  service: string;
  provider: string;
  live: number;
  before: number;
  after: number;
  inserted: number;
  updated: number;
  removed: number;
}


function printDiff(
  target: Target,
  result: ProviderPlanSyncResult,
  existing: Map<string, { name?: string; amount?: number; vendor?: string }>,
  ownedCount: number,
): void {
  const liveByCode = new Map<string, { name: string; amount: number }>();
  for (const row of target.rows) {
    liveByCode.set(row.productCode, { name: row.name, amount: row.amount });
  }
  console.log(
    `\n── ${target.service} / ${target.provider} (serviceID=${target.serviceID}) — live ${target.rows.length} · VTPass rows ${ownedCount}`,
  );
  if (result.inserted + result.updated + result.removed === 0) {
    console.log('   already in sync — nothing to change');
    return;
  }
  if (result.insertedCodes.length > 0) {
    console.log(`   INSERT (${result.insertedCodes.length})`);
    for (const code of result.insertedCodes) {
      const live = liveByCode.get(code)!;
      console.log(`     + ${code.padEnd(26)} ${money(live.amount).padStart(12)}  ${live.name}`);
    }
  }
  if (result.updatedCodes.length > 0) {
    console.log(`   UPDATE (${result.updatedCodes.length})`);
    for (const code of result.updatedCodes) {
      const live = liveByCode.get(code)!;
      const old = existing.get(code);
      const delta =
        old && old.amount != null && old.amount !== live.amount
          ? `  (was ${money(old.amount)})`
          : old && old.name !== live.name
            ? `  (was "${old.name}")`
            : '';
      console.log(
        `     ~ ${code.padEnd(26)} ${money(live.amount).padStart(12)}  ${live.name}${delta}`,
      );
    }
  }
  if (result.removedCodes.length > 0) {
    console.log(`   DELETE (${result.removedCodes.length})`);
    for (const code of result.removedCodes) {
      const old = existing.get(code);
      const label = old?.amount != null ? money(old.amount).padStart(12) : ''.padStart(12);
      console.log(`     - ${code.padEnd(26)} ${label}  ${old?.name ?? '(unknown)'}`);
    }
  }
  if (result.duplicateCodes.length > 0) {
    console.log(
      `   DUPLICATES (${result.duplicateCodes.length}) — keeping the oldest row: ${result.duplicateCodes.join(', ')}`,
    );
  }
}


async function main(): Promise<void> {
  const baseUrl = endpointBase();
  const apiKey = process.env.VTPASS_API_KEY ?? '';
  const publicKey = process.env.VTPASS_PUBLIC_KEY ?? '';
  if (!baseUrl || !apiKey || !publicKey) {
    console.error(
      '[sync] VTPASS_BASE_URL / VTPASS_API_KEY / VTPASS_PUBLIC_KEY are required (see backend/.env).',
    );
    process.exit(1);
  }

  await mongoose.connect(uri);
  const CatalogModel: any =
    mongoose.models.CatalogItem ?? mongoose.model('CatalogItem', CatalogItemSchema);
  const StatusModel: any =
    mongoose.models.CatalogSyncStatus ??
    mongoose.model('CatalogSyncStatus', CatalogSyncStatusSchema);
  const sync = new CatalogSyncService(CatalogModel, StatusModel);

  console.log(
    `[sync] ${apply ? 'APPLY' : 'DRY RUN'} · ${baseUrl} · ${uri.replace(/\/\/[^@]*@/, '//***@')}`,
  );
  if (!apply) console.log('[sync] read-only — re-run with --apply to write the catalog');

  const summaries: Summary[] = [];
  const failures: string[] = [];

  for (const service of selectedServices()) {
    const services = service === ServiceType.CABLE ? CABLE_SERVICES : DATA_SERVICES;
    for (const svc of services) {
      if (providerFilter && svc.provider.toUpperCase() !== providerFilter) continue;
      let target: Target;
      try {
        target = await buildTarget(service, svc);
      } catch (err: any) {
        failures.push(`${service}/${svc.provider}: ${String(err?.message ?? err)}`);
        continue;
      }

      const docs: Array<{ productCode: string; name?: string; amount?: number; vendor?: string }> =
        await CatalogModel.find(
          { service, provider: svc.provider },
          { productCode: 1, name: 1, amount: 1, vendor: 1 },
        ).lean();
      const existing = new Map(docs.map((d) => [String(d.productCode), d]));
      // Rows this sync owns: VTPass/static plans plus legacy rows written before
      // the vendor field existed. Pairgate/Peyflex plans are counted separately.
      const ownedCount = docs.filter((d) => isOwnedVendor(d.vendor)).length;
      const otherVendors = docs.length - ownedCount;

      const result = await sync.syncProviderPlans(service, svc.provider, target.rows, {
        dryRun: !apply,
        vendor: 'vtpass',
      });
      printDiff(target, result, existing, ownedCount);
      if (otherVendors > 0) {
        console.log(
          `   (${otherVendors} row(s) owned by other vendors — left untouched)`,
        );
      }

      const after = apply
        ? (
            await CatalogModel.find(
              { service, provider: svc.provider },
              { vendor: 1 },
            ).lean()
          ).filter((d: { vendor?: string }) => isOwnedVendor(d.vendor)).length
        : ownedCount - result.removed + result.inserted;
      summaries.push({
        service,
        provider: svc.provider,
        live: target.rows.length,
        before: ownedCount,
        after,
        inserted: result.inserted,
        updated: result.updated,
        removed: result.removed,
      });
    }
  }

  if (summaries.length > 0) {
    console.log(`\n── Summary ${apply ? '' : '(dry run)'}`);
    console.log(
      table(
        summaries.map((s) => [
          s.service,
          s.provider,
          String(s.live),
          String(s.before),
          `+${s.inserted}`,
          `~${s.updated}`,
          `-${s.removed}`,
          String(s.after),
          s.after === s.live ? 'in sync' : 'MISMATCH',
        ]),
        ['service', 'provider', 'live', 'catalog', 'insert', 'update', 'delete', 'after', 'status'],
      ),
    );
  }

  if (failures.length > 0) {
    console.error(`\n[sync] ${failures.length} provider(s) could not be fetched:`);
    for (const failure of failures) console.error(`  - ${failure}`);
  }

  await mongoose.disconnect();
  process.exit(failures.length > 0 ? 1 : 0);
}

void main().catch(async (err) => {
  console.error(`[sync] failed: ${String(err?.message ?? err)}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});

