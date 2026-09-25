import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ServiceType } from '../common/enums';
import {
  CustomerVerification,
  ProviderPriceItem,
  RequeryParams,
  VerifyParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
} from './vendor-provider.interface';
import { VendorConfig } from './schemas/vendor-config.schema';
import { MockProvider } from './providers/mock.provider';
import { VtpassProvider } from './providers/vtpass.provider';
import { EbulksmsProvider } from './providers/ebulksms.provider';
import { PairgateProvider } from './providers/pairgate.provider';
import { PeyflexProvider } from './providers/peyflex.provider';
import { CatalogSyncService, DataSyncStatusShape } from '../catalog/catalog-sync.service';
import { DataPlanRow } from '../catalog/data-plan-sync';

export const KNOWN_VENDOR_PROVIDERS = ['mock', 'vtpass', 'ebulksms', 'pairgate', 'peyflex'] as const;
export type KnownVendorProvider = (typeof KNOWN_VENDOR_PROVIDERS)[number];

/**
 * Routes each service to its configured vendor provider.
 *
 * Resolution order for a given service type:
 *   1. an admin-pinned provider stored in the `vendorconfigs` collection, or
 *   2. the per-service default (DATA routes to `pairgate` whenever the
 *      Pairgate provider is configured), or
 *   3. the global `VENDOR_PROVIDER` env default, or
 *   4. the `mock` provider as a last resort.
 *
 * The persisted policy is loaded once at startup and updated in memory as soon
 * as an admin changes it (`setProvider`), so purchases are routed correctly
 * without a restart or a per-request DB read.
 */
@Injectable()
export class VendorService implements OnModuleInit {
  private readonly logger = new Logger(VendorService.name);

  /** Registered provider instances, keyed by provider name. */
  private readonly providers = new Map<string, VendorProvider>();

  /** Effective provider name per service type (persisted admin policy). */
  private readonly configByService = new Map<ServiceType, string>();

  /** Global fallback provider name from the `VENDOR_PROVIDER` env var. */
  private defaultProviderName: string = 'mock';

  /**
   * How often to reconcile the in-memory routing map with Mongo. Lets an admin
   * change made on another instance (or a cold start) take effect here within
   * seconds, so purchases never debit the wrong provider's account.
   */
  private static readonly CONFIG_REFRESH_TTL_MS = 5000;
  private lastConfigRefresh = 0;

  /** A re-seed stuck in 'syncing' longer than this was interrupted (process died). */
  private static readonly SYNC_STALE_MS = 2 * 60 * 1000;

  /** How long a request-triggered sync waits for another sync holding the lock. */
  private static readonly SYNC_WAIT_MS = 90 * 1000;

  /** Poll interval while waiting for the sync lock to free. */
  private static readonly SYNC_POLL_MS = 500;

  /** Status of the current/last DATA catalog re-seed (surfaced in the admin UI). */
  private dataSyncStatus: DataSyncStatusShape = { state: 'idle' };

  /** Guards against overlapping background re-seeds (boot + admin switch). */
  private dataSyncRunning = false;

  /** A re-seed requested while another was running (applied afterwards). */
  private pendingDataSync: { mode: 'background' | 'wait' } | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(VendorConfig.name) private configModel: Model<VendorConfig>,
    mockProvider: MockProvider,
    private readonly vtpassProvider: VtpassProvider,
    ebulksmsProvider: EbulksmsProvider,
    private readonly pairgateProvider: PairgateProvider,
    private readonly peyflexProvider: PeyflexProvider,
    private readonly catalogSync: CatalogSyncService,
  ) {
    this.register(mockProvider);
    this.register(this.vtpassProvider);
    this.register(ebulksmsProvider);
    this.register(this.pairgateProvider);
    this.register(this.peyflexProvider);
  }

  private register(provider: VendorProvider) {
    this.providers.set(provider.name, provider);
  }

  /**
   * Default provider for a service type before any admin pin exists. DATA
   * defaults to Pairgate (the data provider) whenever it is registered and
   * configured with a PAIRGATE_API_KEY; every other service keeps the global
   * `VENDOR_PROVIDER` env default. Falls back to the global default so a
   * keyless dev/CI box still boots on mock/vtpass DATA plans.
   */
  private defaultProviderFor(service: ServiceType): string {
    if (
      service === ServiceType.DATA &&
      this.providers.has('pairgate') &&
      this.pairgateProvider.isConfigured()
    ) {
      return 'pairgate';
    }
    return this.defaultProviderName;
  }

  /** Reload the persisted routing policy at most once per TTL window. */
  private async refreshConfigIfStale(): Promise<void> {
    if (Date.now() - this.lastConfigRefresh < VendorService.CONFIG_REFRESH_TTL_MS) {
      return;
    }
    const docs = await this.configModel.find().lean();
    for (const doc of docs) {
      if (this.providers.has(doc.provider)) {
        this.configByService.set(doc.service, doc.provider);
      }
    }
    this.lastConfigRefresh = Date.now();
  }

  async onModuleInit() {
    const env = String(this.config.get<string>('VENDOR_PROVIDER', 'mock')).toLowerCase();
    this.defaultProviderName = KNOWN_VENDOR_PROVIDERS.includes(env as KnownVendorProvider)
      ? env
      : 'mock';

    const docs = await this.configModel.find().lean();

    // The persisted routing is the source of truth: seeded and admin-pinned
    // choices are loaded as-is and never overridden here, so an explicit switch
    // (e.g. DATA -> vtpass) survives a restart. Pairgate becomes the DATA
    // provider only as a *default* for services without a row yet (see below),
    // or when an operator pins DATA to it.
    for (const doc of docs) {
      this.configByService.set(doc.service, doc.provider);
    }

    // Seed a routing rule for every service that has none yet, so the persisted
    // policy is always complete and the dashboard reflects every service. DATA
    // gets Pairgate (when configured); every other service keeps the global
    // `VENDOR_PROVIDER` env default.
    const missing = Object.values(ServiceType).filter(
      (s) => !this.configByService.has(s),
    );
    for (const service of missing) {
      const provider = this.defaultProviderFor(service);
      try {
        await this.configModel.updateOne(
          { service },
          { $set: { service, provider } },
          { upsert: true },
        );
        this.configByService.set(service, provider);
        this.logger.log(`Seeded default vendor "${provider}" for ${service}`);
      } catch (err: any) {
        this.logger.warn(
          `Could not seed default vendor for ${service}: ${String(err?.message ?? err)}`,
        );
      }
    }

    // Sync status is persisted in Mongo so it survives cold starts and is the
    // same on every instance. Recover a 'syncing' row left behind by a process
    // that died mid-seed, so the admin UI and the purchase gate see the truth.
    this.dataSyncStatus = await this.catalogSync.getSyncStatus();
    if (this.isStaleSync()) {
      this.dataSyncStatus = {
        ...this.dataSyncStatus,
        state: 'error',
        finishedAt: new Date().toISOString(),
        message:
          'The previous DATA re-seed was interrupted (server restarted mid-sync) — re-run it to complete.',
      };
      await this.persistSyncStatus();
    }

    // Pre-warm the combined DATA catalog (every configured data vendor) in the
    // background so the app never ships with an empty plan list on a cold start.
    if (
      this.pairgateProvider.isConfigured() ||
      this.vtpassProvider.isConfigured() ||
      this.peyflexProvider.isConfigured()
    ) {
      this.syncDataFrom();
    }

    this.logger.log(
      `Vendor routing: ${Object.values(ServiceType)
        .map((s) => `${s}=${this.getProvider(s).name}`)
        .join(', ')}`,
    );
  }

  /** Resolve the provider instance that fulfils a given service type. */
  getProvider(service: ServiceType): VendorProvider {
    const pinned = this.configByService.get(service);
    if (pinned && this.providers.has(pinned)) {
      return this.providers.get(pinned)!;
    }
    const fallback = this.providers.get(this.defaultProviderFor(service));
    return fallback ?? this.providers.get('mock')!;
  }

  /**
   * Provider name — either for the whole platform (no arg, used by the
   * dashboard) or the effective provider for a single service.
   */
  getProviderName(service?: ServiceType): string {
    if (service) return this.getProvider(service).name;
    return this.providers.get(this.defaultProviderName)?.name ?? 'mock';
  }

  getProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  /** Registered providers + the services each one can fulfil. */
  getProviderCapabilities(): { name: string; supportedServices: ServiceType[] }[] {
    return [...this.providers.values()].map((p) => ({
      name: p.name,
      supportedServices: [...p.supportedServices],
    }));
  }

  /** Effective routing for every service type (for the admin UI + dashboard). */
  getEffectiveConfig(): {
    service: ServiceType;
    provider: string;
    supported: boolean;
  }[] {
    return Object.values(ServiceType).map((service) => {
      const provider = this.getProvider(service);
      return {
        service,
        provider: this.configByService.get(service) ?? provider.name,
        supported: provider.supportedServices.includes(service),
      };
    });
  }

  /** True when a sync has been 'syncing' so long the process must have died. */
  private isStaleSync(): boolean {
    if (this.dataSyncStatus.state !== 'syncing') return false;
    const startedAt = this.dataSyncStatus.startedAt;
    if (!startedAt) return false;
    const age = Date.now() - Date.parse(startedAt);
    return !Number.isNaN(age) && age > VendorService.SYNC_STALE_MS;
  }

  /** Status as surfaced to the UI: stale 'syncing' reads as an interruption. */
  private effectiveSyncStatus(): DataSyncStatusShape {
    if (!this.isStaleSync()) return { ...this.dataSyncStatus };
    return {
      ...this.dataSyncStatus,
      state: 'error',
      finishedAt: new Date().toISOString(),
      message:
        'The previous DATA re-seed was interrupted (server restarted mid-sync) — run Re-sync DATA plans to complete it.',
    };
  }

  /** Whether DATA purchases are paused by a LIVE re-seed (not a stale one). */
  private isSyncActive(): boolean {
    return this.dataSyncStatus.state === 'syncing' && !this.isStaleSync();
  }

  /** Write the in-memory status to Mongo (best-effort — status is advisory). */
  private async persistSyncStatus(): Promise<void> {
    try {
      await this.catalogSync.persistSyncStatus(this.dataSyncStatus);
    } catch (err: any) {
      this.logger.warn(
        `[catalog] could not persist DATA sync status: ${String(err?.message ?? err)}`,
      );
    }
  }

  /**
   * Request-path wait for the DATA re-seed lock: another sync (this instance)
   * holds it, but a queued run is guaranteed once it frees. Poll until a terminal
   * status lands or SYNC_WAIT_MS elapses, so the switch / manual refresh reports
   * the true outcome instead of relying on a fire-and-forget background job that
   * a serverless host may kill as soon as the triggering request returns.
   */
  private async waitForSyncLock(): Promise<DataSyncStatusShape> {
    const deadline = Date.now() + VendorService.SYNC_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, VendorService.SYNC_POLL_MS));
      if (!this.dataSyncRunning && this.dataSyncStatus.state !== 'syncing') {
        return this.effectiveSyncStatus();
      }
    }
    this.logger.warn('[catalog] timed out waiting for the DATA re-seed lock');
    return this.effectiveSyncStatus();
  }

  async getVendorOverview() {
    await this.refreshConfigIfStale();
    return {
      globalDefault: this.defaultProviderName,
      providers: this.getProviderCapabilities(),
      configs: this.getEffectiveConfig(),
      dataCatalog: await this.catalogSync.countDataPlans(),
      dataSync: this.effectiveSyncStatus(),
    };
  }

  /**
   * Trigger a re-seed of the combined DATA catalog — every configured vendor's
   * plan list. Awaited (not fire-and-forget): on the hosted serverless backend,
   * background work is killed when the request returns, so the re-seed runs to
   * completion inside this request and the status is persisted at every step.
   */
  async refreshDataSync() {
    await this.refreshConfigIfStale();
    await this.syncAllDataPlans('wait');
    return {
      dataSync: this.effectiveSyncStatus(),
      dataCatalog: await this.catalogSync.countDataPlans(),
    };
  }

  /** Persist an admin routing change and apply it immediately. */
  async setProvider(service: ServiceType, provider: string): Promise<VendorConfig> {
    if (!KNOWN_VENDOR_PROVIDERS.includes(provider as KnownVendorProvider)) {
      throw new BadRequestException(`Unknown vendor provider: ${provider}`);
    }
    if (!this.providers.has(provider)) {
      throw new BadRequestException(
        `Vendor provider "${provider}" is not registered`,
      );
    }
    const doc = await this.configModel.findOneAndUpdate(
      { service },
      { $set: { service, provider } },
      { upsert: true, new: true },
    );
    this.configByService.set(service, provider);
    this.logger.log(`Vendor routing: ${service} → ${provider}`);

    // DATA no longer re-seeds on a switch: the catalog keeps every data vendor's
    // plans side by side, and each purchase is routed to the plan's own vendor.
    // The DATA pin now only serves as the fallback vendor for legacy plans.
    return doc;
  }

  /**
   * Background combined DATA re-seed (boot pre-warm). Admin-triggered re-seeds
   * use `syncAllDataPlans('wait')` so they complete inside the request
   * (serverless hosts kill fire-and-forget work on response).
   */
  private syncDataFrom(): void {
    void this.syncAllDataPlans('background').catch((err: any) => {
      this.logger.warn(
        `[catalog] background DATA re-seed failed: ${String(err?.message ?? err)}`,
      );
    });
  }

  /**
   * Re-seed the combined DATA catalog — the plan lists of EVERY configured data
   * vendor (Pairgate + VTPass) in one pass, so the app always shows all vendors'
   * bundles and switching/keeping multiple vendors needs no catalog swap.
   *
   * `mode` is 'background' (fire-and-forget, boot) or 'wait' (admin request
   * paths, which await the final persisted status). Every transition is written
   * to Mongo, keeping the status truthful across instances and cold starts.
   */
  private async syncAllDataPlans(
    mode: 'background' | 'wait' = 'background',
  ): Promise<DataSyncStatusShape> {
    if (this.dataSyncRunning) {
      this.pendingDataSync = { mode };
      this.logger.log('[catalog] DATA re-seed requested while one is running — queued');
      if (mode === 'background') {
        return { state: 'syncing', source: 'all', startedAt: this.dataSyncStatus.startedAt };
      }
      // A queued run is guaranteed once the current one frees the lock; report
      // the final outcome to the caller instead of pretending the sync worked.
      return this.waitForSyncLock();
    }

    this.dataSyncRunning = true;
    this.dataSyncStatus = {
      state: 'syncing',
      source: 'all',
      startedAt: new Date().toISOString(),
    };
    await this.persistSyncStatus();

    const startedAt = this.dataSyncStatus.startedAt!;
    const finish = async (
      status: 'done' | 'error',
      extra: Partial<DataSyncStatusShape> = {},
    ) => {
      this.dataSyncStatus = {
        state: status,
        source: 'all',
        startedAt,
        finishedAt: new Date().toISOString(),
        ...extra,
      };
      await this.persistSyncStatus();
    };

    try {
      const rows: DataPlanRow[] = [];
      const fetchErrors: string[] = [];

      if (this.pairgateProvider.isConfigured()) {
        try {
          rows.push(...(await this.pairgateProvider.fetchAllDataPlans()));
        } catch (err: any) {
          fetchErrors.push(`pairgate: ${String(err?.message ?? err)}`);
        }
      }
      if (this.peyflexProvider.isConfigured()) {
        try {
          rows.push(...(await this.peyflexProvider.fetchAllDataPlans()));
        } catch (err: any) {
          fetchErrors.push(`peyflex: ${String(err?.message ?? err)}`);
        }
      }
      if (this.vtpassProvider.isConfigured()) {
        try {
          rows.push(...(await this.vtpassProvider.fetchAllDataPlans()));
        } catch (err: any) {
          fetchErrors.push(`vtpass: ${String(err?.message ?? err)}`);
        }
      }

      if (rows.length === 0) {
        const message =
          fetchErrors.length > 0
            ? `DATA fetch failed: ${fetchErrors.join('; ')}`
            : 'No data vendor is configured — set a VTPass and/or PAIRGATE_API_KEY';
        this.logger.warn(`[catalog] ${message}`);
        await finish('error', { message });
        return this.dataSyncStatus;
      }

      if (fetchErrors.length > 0) {
        this.logger.warn(
          `[catalog] partial DATA fetch: ${fetchErrors.join('; ')} — seeded the plans that succeeded`,
        );
      }

      const { synced, removed } = await this.catalogSync.replaceDataCatalog(rows);
      this.logger.log(
        `[catalog] DATA plans re-seeded from all vendors: ${synced} upserted, ${removed} pruned`,
      );
      await finish('done', { synced, removed });
    } finally {
      this.dataSyncRunning = false;
      const queued = this.pendingDataSync;
      this.pendingDataSync = null;
      if (queued) {
        this.logger.log('[catalog] running queued DATA re-seed');
        void this.syncAllDataPlans(queued.mode).catch((err: any) => {
          this.logger.warn(
            `[catalog] queued DATA re-seed failed: ${String(err?.message ?? err)}`,
          );
        });
      }
    }
    return this.dataSyncStatus;
  }

  async buy(order: VendorOrder): Promise<VendorResult> {
    await this.refreshConfigIfStale();
    // DATA plans carry their fulfilling vendor (`order.vendor`, from the catalog
    // row the user picked): the plan's OWN vendor account is debited. Legacy
    // plans without a vendor fall back to the pinned/global DATA provider.
    if (order.serviceType === ServiceType.DATA) {
      const vendor = String(order.vendor ?? '').toLowerCase();
      const dataProvider =
        (vendor === 'pairgate' || vendor === 'vtpass' || vendor === 'peyflex') &&
        this.providers.has(vendor)
          ? this.providers.get(vendor)!
          : this.getProvider(ServiceType.DATA);
      this.logger.log(
        `[vendor] DATA buy (requestId=${order.requestId}) -> ${dataProvider.name}`,
      );
      return dataProvider.buyData(order);
    }
    const provider = this.getProvider(order.serviceType);
    this.logger.log(
      `[vendor] ${order.serviceType} buy (requestId=${order.requestId}) -> ${provider.name}`,
    );
    switch (order.serviceType) {
      case ServiceType.AIRTIME:
        return provider.buyAirtime(order);
      case ServiceType.CABLE:
        return provider.buyCable(order);
      case ServiceType.ELECTRICITY:
        return provider.buyElectricity(order);
      case ServiceType.WAEC:
        return provider.buyWaec(order);
      case ServiceType.JAMB:
        if (!provider.buyJamb) {
          return {
            status: 'failed',
            message: `${provider.name} does not support JAMB purchases — configure VENDOR_PROVIDER=vtpass or pin 'vtpass' for JAMB in the admin vendor settings.`,
          };
        }
        return provider.buyJamb(order);
      case ServiceType.SMS:
        return provider.buySms(order);
      default:
        throw new BadRequestException(
          `Unsupported service type: ${order.serviceType}`,
        );
    }
  }

  async requery(params: RequeryParams): Promise<VendorResult> {
    await this.refreshConfigIfStale();
    return this.getProvider(params.serviceType).requery(params);
  }

  async verifyCustomer(params: VerifyParams): Promise<CustomerVerification> {
    await this.refreshConfigIfStale();
    return this.getProvider(params.serviceType).verifyCustomer(params);
  }

  /**
   * Current provider price for a product — source of the live margins on the
   * admin Profits page. Falls back to `null` when the configured provider has
   * no price catalogue (or the lookup fails).
   */
  async getProviderPrice(params: ProviderPriceItem): Promise<number | null> {
    await this.refreshConfigIfStale();
    const vendor = String(params.vendor ?? '').toLowerCase();
    const provider =
      params.serviceType === ServiceType.DATA &&
      (vendor === 'pairgate' || vendor === 'vtpass' || vendor === 'peyflex') &&
      this.providers.has(vendor)
        ? this.providers.get(vendor)!
        : this.getProvider(params.serviceType);
    if (!provider.getProviderPrice) return null;
    try {
      return await provider.getProviderPrice(params);
    } catch (err: any) {
      this.logger.warn(
        `Provider price lookup ${params.serviceType}/${params.productCode} failed: ${String(err?.message ?? err)}`,
      );
      return null;
    }
  }

  /** Balance of the global/default provider (kept for backwards-compat). */
  async getBalance(): Promise<{ balance: number; currency: string }> {
    try {
      await this.refreshConfigIfStale();
      const provider = this.providers.get(this.defaultProviderName);
      return provider
        ? await provider.getBalance()
        : { balance: 0, currency: 'NGN' };
    } catch {
      return { balance: 0, currency: 'NGN' };
    }
  }

  /** Balances for every registered provider (admin overview). */
  async getBalances(): Promise<
    { provider: string; balance: number; currency: string }[]
  > {
    await this.refreshConfigIfStale();
    const out: { provider: string; balance: number; currency: string }[] = [];
    for (const [name, provider] of this.providers) {
      try {
        const b = await provider.getBalance();
        out.push({ provider: name, ...b });
      } catch {
        out.push({ provider: name, balance: 0, currency: 'NGN' });
      }
    }
    return out;
  }
}