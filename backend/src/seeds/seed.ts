import 'dotenv/config';
import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { CATALOG_SEED, SeedItem } from './catalog-seed';

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

  // Remove stale DATA bundles whose product codes no longer exist in the seed
  // (codes that don't match the vendor's variation list would fail purchases).
  const dataCodes = new Set(
    CATALOG_SEED.filter((i) => i.service === 'DATA').map((i) => i.productCode),
  );
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