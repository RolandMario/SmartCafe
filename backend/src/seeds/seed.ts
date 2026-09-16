import 'dotenv/config';
import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { CATALOG_SEED, SeedItem } from './catalog-seed';
import {
  DATA_SERVICES,
  cleanDataPlanName,
  dataValidityDays,
} from '../catalog/data-plan-sync';

const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/vtu';

/**
 * VTPass exposes WAEC via two serviceIDs, each with its own variation list.
 * The catalog productCodes are internal identifiers — map them to the VTPass
 * serviceID + variation_code so the seed can fetch the authoritative prices.
 */
const WAEC_VARIATIONS: Record<string, { serviceID: string; variationCode: string }> = {
  'waec-result-checker': { serviceID: 'waec', variationCode: 'waecdirect' },
  'waec-registration': { serviceID: 'waec-registration', variationCode: 'waec-registraion' },
};

/**
 * JAMB pins are vended under a single VTPass serviceID (`jamb`) whose
 * variation codes ARE the catalog product codes.
 */
const JAMB_VARIATIONS: Record<string, { serviceID: string; variationCode: string }> = {
  'utme-mock': { serviceID: 'jamb', variationCode: 'utme-mock' },
  'utme-no-mock': { serviceID: 'jamb', variationCode: 'utme-no-mock' },
};

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true, lowercase: true },
    phone: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'user' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
  },
  { timestamps: true },
);

const catalogSchema = new mongoose.Schema(
  {
    service: String,
    provider: String,
    providerLabel: String,
    productCode: String,
    name: String,
    description: { type: String, default: '' },
    amount: Number,
    minAmount: Number,
    maxAmount: Number,
    unitPrice: Number,
    validityDays: Number,
    commission: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const User: any = mongoose.models.User || mongoose.model('User', userSchema);
const Wallet: any = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);
const CatalogItem: any =
  mongoose.models.CatalogItem || mongoose.model('CatalogItem', catalogSchema);

async function seedCatalog() {
  let created = 0;
  for (const item of CATALOG_SEED) {
    const result = await CatalogItem.updateOne(
      { service: item.service, provider: item.provider, productCode: item.productCode },
      { $set: item as SeedItem & { active: boolean; commission: number } },
      { upsert: true },
    );
    if (result.upsertedCount) created++;
  }

  await syncWaecPricing();
  await syncJambPricing();
  const liveDataCodes = await syncDataPlans();

  // Remove stale DATA bundles — rows whose variation codes no longer exist in the
  // authoritative list (the live VTPass sync when it ran, the static seed otherwise).
  // Stale codes would fail purchases with "invalid variation" on /pay.
  const dataProviderCodes = new Map<string, Set<string>>();
  for (const item of CATALOG_SEED) {
    if (item.service !== 'DATA') continue;
    const codes = dataProviderCodes.get(item.provider) ?? new Set<string>();
    codes.add(item.productCode);
    dataProviderCodes.set(item.provider, codes);
  }
  if (liveDataCodes) {
    for (const [provider, codes] of liveDataCodes) dataProviderCodes.set(provider, codes);
  }
  const dataCodes = new Set<string>();
  for (const codes of dataProviderCodes.values()) {
    for (const code of codes) dataCodes.add(code);
  }
  const stale = await CatalogItem.deleteMany({
    service: 'DATA',
    provider: { $in: ['MTN', 'GLO', 'AIRTEL', '9MOBILE'] },
    productCode: { $nin: [...dataCodes] },
  });
  if (stale.deletedCount) {
    console.log(`[catalog] removed ${stale.deletedCount} stale data bundles`);
  }

  // Remove stale AIRTIME rows whose product codes no longer exist in the seed.
  // Older seeds stored 9mobile airtime under productCode '9mobile', but VTPass
  // only recognises the serviceID 'etisalat' — a stale code would fail every
  // 9mobile purchase with "product does not exist".
  const airtimeCodes = new Set(
    CATALOG_SEED.filter((i) => i.service === 'AIRTIME').map((i) => i.productCode),
  );
  const staleAirtime = await CatalogItem.deleteMany({
    service: 'AIRTIME',
    provider: { $in: ['MTN', 'GLO', 'AIRTEL', '9MOBILE'] },
    productCode: { $nin: [...airtimeCodes] },
  });
  if (staleAirtime.deletedCount) {
    console.log(`[catalog] removed ${staleAirtime.deletedCount} stale airtime rows`);
  }

  // Remove stale ELECTRICITY disco entries that use legacy non-VTPass service
  // IDs (e.g. 'aedc', 'phed'). VTPass only recognises the real serviceIDs
  // (ikeja-electric, abuja-electric, ...) — the provider fallback map covers
  // any records left behind, but duplicates would confuse the app's disco list.
  const legacyElectricProviders = [
    'aedc',
    'phed',
    'ibedc',
    'eedc',
    'kaedco',
    'kedco',
    'jedc',
    'bedc',
  ];
  const staleElectric = await CatalogItem.deleteMany({
    service: 'ELECTRICITY',
    provider: { $in: legacyElectricProviders },
    productCode: { $in: legacyElectricProviders },
  });
  if (staleElectric.deletedCount) {
    console.log(`[catalog] removed ${staleElectric.deletedCount} stale electricity discos`);
  }

  console.log(`[catalog] ${CATALOG_SEED.length} products ensured (${created} new)`);
}

/**
 * Replace the DATA catalog for every network with the REAL plans VTPass currently
 * sells (GET /service-variations?serviceID=mtn-data, glo-data, ...). Each variation
 * is upserted as an active catalog item using its variation_code as productCode —
 * the exact value VTPass needs on /pay — with the plan name, fixed amount, and
 * validity parsed from the vendor's own listing. Rows for a provider whose codes
 * are no longer sold are pruned. Falls back to the static seed (no-op) when VTPass
 * isn't configured or unreachable.
 *
 * Returns the live variation codes per provider, or null when nothing was synced
 * (so the caller knows whether the live list or the static seed governs pruning).
 */
async function syncDataPlans(): Promise<Map<string, Set<string>> | null> {
  const rawBase = process.env.VTPASS_BASE_URL ?? '';
  const apiKey = process.env.VTPASS_API_KEY ?? '';
  const publicKey = process.env.VTPASS_PUBLIC_KEY ?? '';
  if (!rawBase || !apiKey || !publicKey) {
    console.log('[catalog] VTPass keys not set — keeping seeded DATA plans');
    return null;
  }
  // VTPass endpoints live under /api (https://vtpass.com/api, ...). Bare-host env
  // values (e.g. https://vtpass.com) 302-redirect-loop on /service-variations, so
  // normalise to the /api mount when it isn't already there.
  const host = rawBase.replace(/\/+$/, '');
  const baseUrl = /\/api\/?$/i.test(host) ? host : `${host}/api`;

  const synced = new Map<string, Set<string>>();
  for (const svc of DATA_SERVICES) {
    let variations: Array<{
      variation_code?: string;
      variation_name?: string;
      name?: string;
      variation_amount?: string;
    }> = [];
    try {
      const { data } = await axios.get(`${baseUrl}/service-variations`, {
        params: { serviceID: svc.serviceID },
        headers: { 'api-key': apiKey, 'public-key': publicKey },
        timeout: 15000,
      });
      variations = data?.content?.variations ?? [];
    } catch (err: any) {
      console.warn(
        `[catalog] ${svc.provider} data: could not reach VTPass (${String(err?.message ?? err)}) — keeping seeded plans`,
      );
      continue;
    }
    if (variations.length === 0) {
      console.warn(
        `[catalog] ${svc.provider} data: variation list empty for "${svc.serviceID}" — keeping seeded plans`,
      );
      continue;
    }

    const codes = new Set<string>();
    // VTPass's live list occasionally repeats a variation_code for different plans
    // (vendor data quirk). Dedupe, last occurrence wins, so each code = one row.
    const plans = new Map<string, { name: string; amount: number; index: number }>();
    for (let i = 0; i < variations.length; i++) {
      const variation = variations[i];
      const productCode = String(variation?.variation_code ?? '').trim();
      const rawName = String(variation?.variation_name ?? variation?.name ?? '').trim();
      const amount = Number(variation?.variation_amount ?? NaN);
      if (!productCode || !rawName || !Number.isFinite(amount) || amount <= 0) continue;
      plans.set(productCode, { name: cleanDataPlanName(rawName), amount, index: i });
    }
    for (const [productCode, plan] of plans) {
      codes.add(productCode);
      await CatalogItem.updateOne(
        { service: 'DATA', provider: svc.provider, productCode },
        {
          $set: {
            service: 'DATA',
            provider: svc.provider,
            providerLabel: svc.providerLabel,
            productCode,
            name: plan.name,
            amount: plan.amount,
            validityDays: dataValidityDays(plan.name, productCode) ?? 30,
            sortOrder: plan.index + 1,
            active: true,
          },
        },
        { upsert: true },
      );
    }

    const removed = await CatalogItem.deleteMany({
      service: 'DATA',
      provider: svc.provider,
      productCode: { $nin: [...codes] },
    });
    console.log(
      `[catalog] ${svc.provider} data: ${codes.size} live plans synced from "${svc.serviceID}"` +
        (removed.deletedCount ? ` (removed ${removed.deletedCount} stale)` : ''),
    );
    synced.set(svc.provider, codes);
  }
  return synced.size > 0 ? synced : null;
}

/**
 * Keep WAEC catalog amounts in sync with the prices VTPass actually provides.
 *
 * Fetches each WAEC service's variation list from VTPass (GET /service-variations)
 * and updates the catalog `amount` to the variation_amount for that product.
 * Requires VTPass credentials (VTPASS_BASE_URL / VTPASS_API_KEY / VTPASS_PUBLIC_KEY);
 * otherwise the seeded amounts are left as-is.
 */
async function syncWaecPricing() {
  const baseUrl = process.env.VTPASS_BASE_URL ?? '';
  const apiKey = process.env.VTPASS_API_KEY ?? '';
  const publicKey = process.env.VTPASS_PUBLIC_KEY ?? '';
  if (!baseUrl || !apiKey || !publicKey) {
    console.log('[catalog] VTPass keys not set — keeping seeded WAEC amounts');
    return;
  }

  const waecSeedItems = CATALOG_SEED.filter((i) => i.service === 'WAEC');
  for (const item of waecSeedItems) {
    const map = WAEC_VARIATIONS[item.productCode];
    if (!map) continue;

    let amount: number;
    try {
      const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/service-variations`, {
        params: { serviceID: map.serviceID },
        headers: { 'api-key': apiKey, 'public-key': publicKey },
        timeout: 15000,
      });
      const variations: Array<{ variation_code?: string; variation_amount?: string }> =
        data?.content?.variations ?? [];
      const variation = variations.find((v) => v.variation_code === map.variationCode);
      amount = Number(variation?.variation_amount);
    } catch (err: any) {
      console.warn(
        `[catalog] WAEC ${item.name}: could not reach VTPass (${String(err?.message ?? err)}) — keeping seeded amount`,
      );
      continue;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn(
        `[catalog] WAEC ${item.name}: variation "${map.variationCode}" not found on service "${map.serviceID}" — keeping seeded amount`,
      );
      continue;
    }

    const prev = (await CatalogItem.findOne({
      service: 'WAEC',
      productCode: item.productCode,
    }).lean()) as { amount?: number } | null;
    await CatalogItem.updateOne(
      { service: 'WAEC', productCode: item.productCode },
      { $set: { amount } },
    );
    console.log(
      `[catalog] WAEC ${item.name}: amount ₦${prev?.amount ?? 'n/a'} → ₦${amount} (from VTPass service-variations)`,
    );
    // Keep the static seed in sync so the defaults stay truthful for mock/no-key runs.
    item.amount = amount;
  }
}

/**
 * Re-syncs JAMB pin prices from VTPass /service-variations?serviceID=jamb so the
 * catalog always reflects the official variation amounts (UTME with/without mock).
 */
async function syncJambPricing() {
  const baseUrl = process.env.VTPASS_BASE_URL ?? 'https://sandbox.vtpass.com/api';
  const apiKey = process.env.VTPASS_API_KEY ?? '';
  const publicKey = process.env.VTPASS_PUBLIC_KEY ?? '';
  const jambSeedItems = CATALOG_SEED.filter((item) => item.service === 'JAMB');
  if (jambSeedItems.length === 0 || !apiKey || !publicKey) return;

  for (const item of jambSeedItems) {
    const map = JAMB_VARIATIONS[item.productCode];
    if (!map) continue;

    let amount: number;
    try {
      const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/service-variations`, {
        params: { serviceID: map.serviceID },
        headers: { 'api-key': apiKey, 'public-key': publicKey },
        timeout: 15000,
      });
      const variations: Array<{ variation_code?: string; variation_amount?: string }> =
        data?.content?.variations ?? [];
      const variation = variations.find((v) => v.variation_code === map.variationCode);
      amount = Number(variation?.variation_amount);
    } catch (err: any) {
      console.warn(
        `[catalog] JAMB ${item.name}: could not reach VTPass (${String(err?.message ?? err)}) — keeping seeded amount`,
      );
      continue;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn(
        `[catalog] JAMB ${item.name}: variation "${map.variationCode}" not found on service "${map.serviceID}" — keeping seeded amount`,
      );
      continue;
    }

    const prev = (await CatalogItem.findOne({
      service: 'JAMB',
      productCode: item.productCode,
    }).lean()) as { amount?: number } | null;
    await CatalogItem.updateOne(
      { service: 'JAMB', productCode: item.productCode },
      { $set: { amount } },
    );
    console.log(
      `[catalog] JAMB ${item.name}: amount ₦${prev?.amount ?? 'n/a'} → ₦${amount} (from VTPass service-variations)`,
    );
    // Keep the static seed in sync so the defaults stay truthful for mock/no-key runs.
    item.amount = amount;
  }
}

async function ensureUser(
  data: { name: string; email: string; phone: string; password: string; role: string; balance: number },
) {
  const existing = (await User.findOne({
    $or: [{ email: data.email }, { phone: data.phone }],
  }).lean()) as any;
  if (existing) {
    console.log(`[user] ${data.email} already exists (id ${existing._id})`);
    return existing;
  }
  const hashed = await bcrypt.hash(data.password, 10);
  const user = await User.create({
    name: data.name,
    email: data.email,
    phone: data.phone,
    password: hashed,
    role: data.role,
    isActive: true,
  });
  const wallet = await Wallet.create({
    user: user._id,
    balance: data.balance,
    currency: 'NGN',
  });
  console.log(
    `[user] created ${data.email} as ${data.role} with wallet ₦${data.balance} (${wallet._id})`,
  );
  return user;
}

async function main() {
  await mongoose.connect(uri);
  console.log(`Connected to ${uri}`);

  await seedCatalog();

  await ensureUser({
    name: process.env.ADMIN_NAME ?? 'Platform Admin',
    email: process.env.ADMIN_EMAIL ?? 'admin@vtuapp.com',
    phone: '08000000001',
    password: process.env.ADMIN_PASSWORD ?? 'Admin@12345',
    role: 'admin',
    balance: 0,
  });

  await ensureUser({
    name: process.env.DEMO_NAME ?? 'Demo User',
    email: process.env.DEMO_EMAIL ?? 'demo@vtuapp.com',
    phone: process.env.DEMO_PHONE ?? '08012345678',
    password: process.env.DEMO_PASSWORD ?? 'Password@123',
    role: 'user',
    balance: Number(process.env.DEMO_WALLET_BALANCE ?? 50000),
  });

  console.log('Seeding complete ✅');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});