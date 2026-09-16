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
import { CatalogSyncService } from '../catalog/catalog-sync.service';
import { DataPlanRow } from '../catalog/data-plan-sync';

export const KNOWN_VENDOR_PROVIDERS = ['mock', 'vtpass', 'ebulksms', 'pairgate'] as const;
export type KnownVendorProvider = (typeof KNOWN_VENDOR_PROVIDERS)[number];

/**
 * Routes each service to its configured vendor provider.
 *
 * Resolution order for a given service type:
 *   1. an admin-pinned provider stored in the `vendorconfigs` collection, or
 *   2. the global `VENDOR_PROVIDER` env default, or
 *   3. the `mock` provider as a last resort.
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

  /** Status of the current/last DATA catalog re-seed (surfaced in the admin UI). */
  private dataSyncStatus: {
    state: 'idle' | 'syncing' | 'done' | 'error';
    source?: 'pairgate' | 'vtpass';
    startedAt?: string;
    finishedAt?: string;
    synced?: number;
    removed?: number;
    message?: string;
  } = { state: 'idle' };

  /** Guards against overlapping background re-seeds (boot + admin switch). */
  private dataSyncRunning = false;

  /** The latest re-seed requested while another was running (applied afterwards). */
  private pendingDataSync: {
    source: 'pairgate' | 'vtpass';
    previousProvider?: string;
  } | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(VendorConfig.name) private configModel: Model<VendorConfig>,
    mockProvider: MockProvider,
    private readonly vtpassProvider: VtpassProvider,
    ebulksmsProvider: EbulksmsProvider,
    private readonly pairgateProvider: PairgateProvider,
    private readonly catalogSync: CatalogSyncService,
  ) {
    this.register(mockProvider);
    this.register(this.vtpassProvider);
    this.register(ebulksmsProvider);
    this.register(this.pairgateProvider);
  }

  private register(provider: VendorProvider) {
    this.providers.set(provider.name, provider);
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
    for (const doc of docs) {
      this.configByService.set(doc.service, doc.provider);
    }

    // Seed a routing rule for every service that has none yet, so the persisted
    // policy is always complete and the dashboard reflects every service.
    const missing = Object.values(ServiceType).filter(
      (s) => !this.configByService.has(s),
    );
    for (const service of missing) {
      try {
        await this.configModel.updateOne(
          { service },
          { $set: { service, provider: this.defaultProviderName } },
          { upsert: true },
        );
        this.configByService.set(service, this.defaultProviderName);
        this.logger.log(
          `Seeded default vendor "${this.defaultProviderName}" for ${service}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Could not seed default vendor for ${service}: ${String(err?.message ?? err)}`,
        );
      }
    }

    // A deployment that boots with DATA already routed to pairgate should ship
    // with Pairgate's plan list (not wait for an admin to flip the switch).
    const dataProvider = this.configByService.get(ServiceType.DATA) ?? this.defaultProviderName;
    if (dataProvider === 'pairgate' && this.pairgateProvider.isConfigured()) {
      this.syncDataFrom('pairgate');
    }
  }

  /** Resolve the provider instance that fulfils a given service type. */
  getProvider(service: ServiceType): VendorProvider {
    const pinned = this.configByService.get(service);
    if (pinned && this.providers.has(pinned)) {
      return this.providers.get(pinned)!;
    }
    const fallback = this.providers.get(this.defaultProviderName);
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

  async getVendorOverview() {
    await this.refreshConfigIfStale();
    return {
      globalDefault: this.defaultProviderName,
      providers: this.getProviderCapabilities(),
      configs: this.getEffectiveConfig(),
      dataCatalog: await this.catalogSync.countDataPlans(),
      dataSync: { ...this.dataSyncStatus },
    };
  }

  /** Trigger a manual DATA catalog re-seed from the active provider (admin button). */
  async refreshDataSync() {
    await this.refreshConfigIfStale();
    const provider = this.getProvider(ServiceType.DATA).name;
    if (provider === 'pairgate' || provider === 'vtpass') {
      this.syncDataFrom(provider as 'pairgate' | 'vtpass');
    }
    return {
      dataSync: { ...this.dataSyncStatus },
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
    const previous = this.configByService.get(service);
    const doc = await this.configModel.findOneAndUpdate(
      { service },
      { $set: { service, provider } },
      { upsert: true, new: true },
    );
    this.configByService.set(service, provider);
    this.logger.log(`Vendor routing: ${service} → ${provider}`);

    // DATA is the only service pairgate vends, so a routing change on it swaps
    // the whole DATA catalog: Pairgate's own plan list (productCode = plan_id)
    // when enabled, the VTPass plan list (or static seed) when disabled.
    if (service === ServiceType.DATA && previous !== provider) {
      if (provider === 'pairgate') {
        this.syncDataFrom('pairgate', previous);
      } else if (previous === 'pairgate') {
        this.syncDataFrom('vtpass');
      }
    }
    return doc;
  }

  /**
   * Background DATA catalog re-seed when the admin flips the DATA routing.
   * Pairgate throttles requests (~1-2s), so the sync runs off the hot path and
   * the admin PATCH returns immediately; the plan list lands shortly after.
   */
  private syncDataFrom(source: 'pairgate' | 'vtpass', previousProvider?: string): void {
    void this.syncDataPlans(source, previousProvider).catch((err: any) => {
      this.logger.warn(
        `[catalog] background DATA re-seed from ${source} failed: ${String(err?.message ?? err)}`,
      );
    });
  }

  private async syncDataPlans(
    source: 'pairgate' | 'vtpass',
    previousProvider?: string,
  ): Promise<void> {
    if (this.dataSyncRunning) {
      // Keep the LATEST requested provider — e.g. an admin flipping DATA back
      // to vtpass while pairgate is still re-seeding must not be dropped.
      this.pendingDataSync = { source, previousProvider };
      this.logger.log(
        `[catalog] DATA re-seed from ${source} requested while a sync is running — queued`,
      );
      return;
    }
    this.dataSyncRunning = true;
    this.dataSyncStatus = {
      state: 'syncing',
      source,
      startedAt: new Date().toISOString(),
    };
    const startedAt = this.dataSyncStatus.startedAt!;
    const finish = (status: 'done' | 'error', extra: Partial<typeof this.dataSyncStatus> = {}) => {
      this.dataSyncStatus = {
        state: status,
        source,
        startedAt,
        finishedAt: new Date().toISOString(),
        ...extra,
      };
    };

    try {
      let rows: DataPlanRow[] = [];
      try {
        rows =
          source === 'pairgate'
            ? await this.pairgateProvider.fetchAllDataPlans()
            : await this.vtpassProvider.fetchAllDataPlans();
      } catch (err: any) {
        const message = String(err?.message ?? 'DATA fetch failed');
        this.logger.warn(`[catalog] ${source} DATA fetch failed: ${message}`);
        finish('error', { message });
        return;
      }

      if (!rows.length) {
        if (source === 'pairgate' && previousProvider && previousProvider !== 'pairgate') {
          // Pairgate produced no plans — don't leave DATA pointed at a provider
          // whose plans aren't in the catalog (every purchase would fail). Revert
          // the routing to what it was before the switch.
          this.logger.warn(
            `[catalog] Pairgate returned no DATA plans — reverting DATA routing to "${previousProvider}"`,
          );
          this.configByService.set(ServiceType.DATA, previousProvider);
          await this.configModel.updateOne(
            { service: ServiceType.DATA },
            { $set: { service: ServiceType.DATA, provider: previousProvider } },
            { upsert: true },
          );
          finish('error', {
            message: `Pairgate returned no plans — reverted DATA to ${previousProvider}`,
          });
        } else {
          const message = `${source} returned no DATA plans — catalog left untouched`;
          this.logger.warn(`[catalog] ${message}`);
          finish('error', { message });
        }
        return;
      }

      const { synced, removed } = await this.catalogSync.replaceDataCatalog(rows);
      this.logger.log(
        `[catalog] DATA plans re-seeded from ${source}: ${synced} upserted, ${removed} pruned`,
      );
      finish('done', { synced, removed });
    } finally {
      this.dataSyncRunning = false;
      const queued = this.pendingDataSync;
      this.pendingDataSync = null;
      if (queued) {
        this.logger.log(`[catalog] running queued DATA re-seed from ${queued.source}`);
        void this.syncDataPlans(queued.source, queued.previousProvider).catch((err: any) => {
          this.logger.warn(
            `[catalog] queued DATA re-seed from ${queued.source} failed: ${String(err?.message ?? err)}`,
          );
        });
      }
    }
  }

  async buy(order: VendorOrder): Promise<VendorResult> {
    await this.refreshConfigIfStale();
    // While a provider switch is re-seeding the DATA catalog, the old plan rows
    // are being replaced — purchasing them would hit the new provider with stale
    // plan codes. Refuse politely instead of returning confusing vendor errors.
    if (
      order.serviceType === ServiceType.DATA &&
      this.dataSyncStatus.state === 'syncing'
    ) {
      this.logger.warn(
        `[vendors] DATA purchase ${order.requestId} deferred — catalog re-seed in progress`,
      );
      return {
        status: 'failed',
        message:
          'The data plan list is being refreshed after the provider switch — please try again in about a minute.',
      };
    }
    const provider = this.getProvider(order.serviceType);
    switch (order.serviceType) {
      case ServiceType.AIRTIME:
        return provider.buyAirtime(order);
      case ServiceType.DATA:
        return provider.buyData(order);
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
    const provider = this.getProvider(params.serviceType);
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