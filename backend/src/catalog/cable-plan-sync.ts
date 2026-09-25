import { CATALOG_SEED } from '../seeds/catalog-seed';
import { cleanDataPlanName } from './data-plan-sync';

/**
 * Normalised row used to (re)seed the CABLE catalog (DSTV / GOTV / StarTimes)
 * from VTPass's live variation lists. Mirrors `DataPlanRow` so the vendor
 * adapter, the seed script and any future runtime sync all speak one shape.
 */
export interface CablePlanRow {
  /** Catalog provider key: DSTV | GOTV | STARTIMES. */
  provider: string;
  /** Display label, e.g. 'DStv'. */
  providerLabel: string;
  /** VTPass variation_code — the exact value /pay needs. */
  productCode: string;
  /** Vendor that fulfils this plan (its account is debited on purchase). */
  vendor: 'vtpass' | 'static';
  name: string;
  /** Provider's price (becomes the catalog `amount`). */
  amount: number;
  description?: string;
}

/**
 * Cable is vended under per-brand VTPass serviceIDs (dstv / gotv / startimes)
 * whose variation lists ARE the real plan catalogues. The catalog stores each
 * plan's variation_code as `productCode`, and the provider slug on the order
 * tells /pay which serviceID to hit (see VtpassProvider.cableServiceId).
 */
export const CABLE_SERVICES: ReadonlyArray<{
  serviceID: string;
  provider: string;
  providerLabel: string;
}> = [
  { serviceID: 'dstv', provider: 'DSTV', providerLabel: 'DStv' },
  { serviceID: 'gotv', provider: 'GOTV', providerLabel: 'GOtv' },
  { serviceID: 'startimes', provider: 'STARTIMES', providerLabel: 'StarTimes' },
];

/**
 * Cable plan names embed the price ("DStv Padi N4,400", "Nova (Dish) - 2100
 * Naira - 1 Month"). The app renders the price separately, so drop any
 * standalone naira token — same cleanup rule the DATA plans already use.
 */
export function cleanCablePlanName(raw: string): string {
  return cleanDataPlanName(raw);
}

/**
 * Static CABLE seed rows — the fallback plan list when VTPass isn't configured
 * or unreachable (mirrors the seed script keeping the bundled cable plans).
 */
export function staticCablePlanRows(): CablePlanRow[] {
  return CATALOG_SEED
    .filter((item) => item.service === 'CABLE')
    .map((item) => ({
      provider: item.provider,
      providerLabel: item.providerLabel,
      productCode: item.productCode,
      vendor: 'static' as const,
      name: item.name,
      amount: item.amount ?? 0,
      description: '',
    }));
}