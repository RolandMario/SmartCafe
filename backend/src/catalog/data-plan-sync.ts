import { CATALOG_SEED } from '../seeds/catalog-seed';

/**
 * Normalised row used to (re)seed the DATA catalog from a vendor plan listing.
 * Shared by the runtime vendor-switch sync (see CatalogSyncService) and helpers
 * used by the standalone seed script + the vendor adapters.
 */
export interface DataPlanRow {
  /** Catalog provider key, e.g. MTN | GLO | AIRTEL | 9MOBILE. */
  provider: string;
  /** Display label, e.g. 'MTN Nigeria'. */
  providerLabel: string;
  /** Vendor plan id (pairgate plan_id / VTPass variation code). */
  productCode: string;
  /** Vendor that fulfils this plan (its account is debited on purchase). */
  vendor: 'pairgate' | 'vtpass' | 'static';
  name: string;
  /** Provider's price (becomes the catalog `amount`). */
  amount: number;
  validityDays?: number;
  description?: string;
}

/**
 * DATA is vended under per-network serviceIDs (mtn-data, glo-data, ...) whose
 * variation lists ARE the real plan catalogues. The old static seed used
 * invented codes (mtn-50mb-200, glo100, ...) that don't exist on the live
 * /service-variations endpoint, so the app displayed - and /pay attempted -
 * plans VTPass could never fulfil.
 */
export const DATA_SERVICES: ReadonlyArray<{
  serviceID: string;
  provider: string;
  providerLabel: string;
}> = [
  { serviceID: 'mtn-data', provider: 'MTN', providerLabel: 'MTN Nigeria' },
  { serviceID: 'glo-data', provider: 'GLO', providerLabel: 'Globacom' },
  { serviceID: 'airtel-data', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria' },
  { serviceID: 'etisalat-data', provider: '9MOBILE', providerLabel: '9mobile' },
];

/** Pairgate identifies networks by lowercase slug on /data-plans and /data/purchase. */
export const PAIRGATE_PROVIDER_SLUGS: Readonly<Record<string, string>> = {
  MTN: 'mtn',
  GLO: 'glo',
  AIRTEL: 'airtel',
  '9MOBILE': '9mobile',
};

/** Display labels used when re-seeding the DATA catalog from Pairgate. */
export const PAIRGATE_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  MTN: 'MTN Nigeria',
  GLO: 'Globacom',
  AIRTEL: 'Airtel Nigeria',
  '9MOBILE': '9mobile',
};

/**
 * VTPass embeds the price in display names ("... - N100", "MTN N500 1GB ...",
 * "2.5GB Daily Plan - 750 Naira"). The app already renders the price separately,
 * so drop any standalone naira token before storing the name.
 */
export function cleanDataPlanName(raw: string): string {
  let name = String(raw ?? '').trim();
  name = name
    .replace(/(?<![A-Za-z])N\s*,?\s*[\d.,]+\b/gi, ' ')
    .replace(/\b[\d.,]+\s*Naira\b/gi, ' ')
    .replace(/₦\s*[\d.,]+/g, ' ');
  // Price tokens usually sit next to a dash; tidy up the leftover dash/space runs.
  name = name
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*$/g, '')
    .replace(/^\s*-\s*/g, '')
    .trim();
  return name || String(raw ?? '').trim();
}

/** "110MB Daily Plan (1 Day)" -> 1, "1.5GB Weekly Plan (7 Days)" -> 7, "3-Month" -> 90, "Yearly" -> 365. */
export function dataValidityDays(name: string, code: string): number | undefined {
  const label = String(name ?? '');
  const days = label.match(/(\d+)\s*[Dd]ays?\b/);
  if (days) return Number(days[1]);
  const months = label.match(/(\d+)\s*-\s*[Mm]onth/);
  if (months) return Number(months[1]) * 30;
  if (/yearly/i.test(String(code ?? '')) || /\b[Yy]early\b/.test(label)) return 365;
  if (/\b[Ww]eekly\b/.test(label)) return 7;
  if (/monthly/i.test(String(code ?? '')) || /\b[Mm]onthly\b/.test(label)) return 30;
  if (/\b[Dd]aily\b/.test(label)) return 1;
  return undefined;
}

/**
 * Static DATA seed rows — the fallback plan list when a vendor isn't configured
 * or unreachable (mirrors the seed script keeping the bundled DATA plans).
 */
export function staticDataPlanRows(): DataPlanRow[] {
  return CATALOG_SEED
    .filter((item) => item.service === 'DATA')
    .map((item) => ({
      provider: item.provider,
      providerLabel: item.providerLabel,
      productCode: item.productCode,
      vendor: 'static' as const,
      name: item.name,
      amount: item.amount ?? 0,
      validityDays: item.validityDays,
      description: '',
    }));
}