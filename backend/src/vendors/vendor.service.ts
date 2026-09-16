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

  getVendorOverview() {
    return {
      globalDefault: this.defaultProviderName,
      providers: this.getProviderCapabilities(),
      configs: this.getEffectiveConfig(),
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
        this.syncDataFrom('pairgate');
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
  private syncDataFrom(source: 'pairgate' | 'vtpass'): void {
    void this.syncDataPlans(source).catch((err: any) => {
      this.logger.warn(
        `[catalog] background DATA re-seed from ${source} failed: ${String(err?.message ?? err)}`,
      );
    });
  }

  private async syncDataPlans(source: 'pairgate' | 'vtpass'): Promise<void> {
    const rows: DataPlanRow[] =
      source === 'pairgate'
        ? await this.pairgateProvider.fetchAllDataPlans()
        : await this.vtpassProvider.fetchAllDataPlans();
    if (!rows.length) {
      this.logger.warn(`[catalog] ${source} returned no DATA plans — catalog left untouched`);
      return;
    }
    const { synced, removed } = await this.catalogSync.replaceDataCatalog(rows);
    this.logger.log(
      `[catalog] DATA plans re-seeded from ${source}: ${synced} upserted, ${removed} pruned`,
    );
  }

  async buy(order: VendorOrder): Promise<VendorResult> {
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

  requery(params: RequeryParams): Promise<VendorResult> {
    return this.getProvider(params.serviceType).requery(params);
  }

  verifyCustomer(params: VerifyParams): Promise<CustomerVerification> {
    return this.getProvider(params.serviceType).verifyCustomer(params);
  }

  /**
   * Current provider price for a product — source of the live margins on the
   * admin Profits page. Falls back to `null` when the configured provider has
   * no price catalogue (or the lookup fails).
   */
  async getProviderPrice(params: ProviderPriceItem): Promise<number | null> {
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