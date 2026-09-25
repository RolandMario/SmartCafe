import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ServiceType } from '../../common/enums';
import {
  CustomerVerification,
  ProviderPriceItem,
  RequeryParams,
  VerifyParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
} from '../vendor-provider.interface';
import {
  DataPlanRow,
  cleanDataPlanName,
  dataValidityDays,
} from '../../catalog/data-plan-sync';

export interface PeyflexNetwork {
  identifier: string;
  name: string;
}

export interface PeyflexPlan {
  planCode: string;
  amount: number;
  label: string;
}

/**
 * Peyflex provider adapter — airtime, data bundles and electricity tokens.
 *
 * API surface (https://client.peyflex.com.ng — public Postman collection):
 *   - GET  /api/wallet/balance/                -> { wallet_credit }
 *   - GET  /api/airtime/networks/              -> { networks: [{ id, name }] }
 *   - POST /api/airtime/topup/                 { network, amount, mobile_number }
 *   - GET  /api/data/networks/                 -> { networks: [{ identifier, name }] }
 *   - GET  /api/data/plans/?network=<id>       -> { plans: [{ plan_code, amount, label }] }
 *   - POST /api/data/purchase/                 { network, mobile_number, plan_code }
 *   - GET  /api/electricity/verify/            ?identifier=electricity&meter=&plan=&type=
 *   - POST /api/electricity/subscribe/         { identifier, meter, plan, amount, type, phone }
 *
 * Auth is `Authorization: Token <key>` on every request. Business replies arrive
 * on HTTP 200 — electricity carries an explicit `status` of "SUCCESS"/"FAILED",
 * while airtime/data recharges are flat bodies with a `reference` /
 * `transaction_id`. This adapter mirrors the Pairgate error handling: a definite
 * refusal returns `{ status: 'failed', message }`, and a transport error (no
 * server reply) is rethrown so the transactions service keeps the order pending
 * for requery.
 *
 * Note on DATA: Peyflex keys bundles by a *network identifier* (e.g.
 * `mtn_data_share`, `mtn_gifting_data`), not just the network slug. Every plan
 * row seeded into the DATA catalog therefore carries its network id in the
 * `description` field (`Peyflex · <network>`), which buyData() reads back at
 * purchase time. Several identifiers (share / gifting / SME) can map to one
 * catalog provider code (e.g. MTN) without colliding.
 *
 * Configure with PEYFLEX_BASE_URL / PEYFLEX_API_KEY. Peyflex is NOT routed to by
 * default anywhere — an admin must explicitly pin a service to it from the
 * Vendors page (disabled-by-default).
 */
@Injectable()
export class PeyflexProvider implements VendorProvider {
  readonly name = 'peyflex';
  readonly supportedServices: ServiceType[] = [
    ServiceType.AIRTIME,
    ServiceType.DATA,
    ServiceType.ELECTRICITY,
  ];
  private readonly logger = new Logger(PeyflexProvider.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  /** How long a fetched network-id / plan-price cache is considered fresh. */
  private static readonly NETWORK_CACHE_TTL_MS = 10 * 60 * 1000;

  private networkCacheAt = 0;
  private airtimeNetworks: { id: string; name: string }[] = [];
  private dataNetworks: { identifier: string; name: string }[] = [];

  /** plan_code -> amount captured by the latest DATA sync (live margins). */
  private planPriceCache: Record<string, { name: string; amount: number }> = {};
  private planPriceCacheAt = 0;

  constructor(private config: ConfigService) {
    this.baseUrl = String(
      this.config.get<string>('PEYFLEX_BASE_URL') ?? 'https://client.peyflex.com.ng',
    ).replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('PEYFLEX_API_KEY', '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey ? `Token ${this.apiKey}` : '',
      },
    });
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ------------------------------------------------------------------
  // Shared reply helpers — mirrored from the Pairgate adapter.
  // ------------------------------------------------------------------

  /** True when a Peyflex business reply is a definite refusal (HTTP 200 FAILED). */
  private static isFailed(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const status = String(payload.status ?? '').toUpperCase();
    return status === 'FAILED' || status === 'ERROR';
  }

  /**
   * True when a Peyflex reply reads as a success: an explicit SUCCESS status
   * (electricity) or a flat recharge body carrying a reference/transaction_id
   * (airtime/data replies have no status field).
   */
  private static isOk(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const status = String(payload.status ?? '').toUpperCase();
    if (status === 'SUCCESS' || status === 'SUCCESSFUL') return true;
    if (!status) return !!(payload.reference || payload.transaction_id);
    return false;
  }

  /** Best human message for a failed reply / HTTP error body. */
  private static messageOf(body: any): string {
    if (!body || typeof body !== 'object') return 'Peyflex rejected the request';
    const text = String(body.message ?? body.detail ?? body.error ?? '').trim();
    return text || 'Peyflex rejected the request';
  }

  /**
   * GET /api/wallet/balance/ — remaining Peyflex wallet credit (wholesale).
   */
  async getBalance(): Promise<{ balance: number; currency: string }> {
    if (!this.apiKey) return { balance: 0, currency: 'NGN' };
    try {
      const { data } = await this.client.get('/api/wallet/balance/', {
        timeout: 20000,
      });
      const payload = data?.data ?? data ?? {};
      const balance = Number(payload.wallet_credit ?? payload.balance ?? NaN);
      return {
        balance: Number.isFinite(balance) ? balance : 0,
        currency: 'NGN',
      };
    } catch {
      return { balance: 0, currency: 'NGN' };
    }
  }

  // ------------------------------------------------------------------
  // DATA — network + plan listing (catalog re-seed source).
  // ------------------------------------------------------------------

  /**
   * Peyflex data networks map onto the same catalog provider codes the mobile
   * app already knows (MTN / GLO / AIRTEL / 9MOBILE). Identifiers like
   * `mtn_data_share` and `mtn_gifting_data` both resolve to MTN.
   */
  private static providerForNetwork(identifier: string): string | null {
    const id = String(identifier ?? '').toLowerCase();
    if (id.includes('mtn')) return 'MTN';
    if (id.includes('glo')) return 'GLO';
    if (id.includes('airtel') || id.includes('etisalat')) return 'AIRTEL';
    if (id.includes('9mobile') || id.includes('nine')) return '9MOBILE';
    return null;
  }

  /** Fallback data-network id per catalog provider (used only when a plan row
   *  carries no `Peyflex · <network>` description — legacy/pinned rows). */
  private static readonly DEFAULT_NETWORK_BY_PROVIDER: Readonly<Record<string, string>> = {
    MTN: 'mtn_data_share',
    GLO: 'glo_data',
    AIRTEL: 'airtel_data',
    '9MOBILE': '9mobile_data',
  };

  /** GET /api/data/networks/ — cached briefly; lists every vended data network. */
  private async dataNetworkList(): Promise<PeyflexNetwork[]> {
    if (
      this.dataNetworks.length > 0 &&
      Date.now() - this.networkCacheAt < PeyflexProvider.NETWORK_CACHE_TTL_MS
    ) {
      return this.dataNetworks;
    }
    const { data } = await this.client.get('/api/data/networks/', {
      timeout: 30000,
    });
    const payload = data ?? {};
    const list = Array.isArray(payload?.networks) ? payload.networks : [];
    this.dataNetworks = list
      .map((n: any) => ({
        identifier: String(n?.identifier ?? n?.id ?? '').trim(),
        name: String(n?.name ?? '').trim(),
      }))
      .filter((n) => n.identifier);
    this.networkCacheAt = Date.now();
    return this.dataNetworks;
  }

  /** GET /api/data/plans/?network=<id> — current plan list for one network. */
  async getDataPlans(identifier: string): Promise<PeyflexPlan[]> {
    const { data } = await this.client.get('/api/data/plans/', {
      params: { network: identifier },
      timeout: 30000,
    });
    const payload = data ?? {};
    const list = Array.isArray(payload?.plans) ? payload.plans : [];
    return list
      .map((p: any) => ({
        planCode: String(p?.plan_code ?? '').trim(),
        amount: Number(p?.amount ?? NaN),
        label: String(p?.label ?? '').trim(),
      }))
      .filter((p) => p.planCode && Number.isFinite(p.amount) && p.amount > 0);
  }

  /**
   * Enumerates every available plan across every Peyflex data network — this is
   * what re-seeds the DATA catalog alongside Pairgate/VTPass. Each row embeds
   * its Peyflex network id in `description` so buyData() can replay it later.
   */
  async fetchAllDataPlans(): Promise<DataPlanRow[]> {
    const networks = await this.dataNetworkList();
    const rows: DataPlanRow[] = [];
    for (const net of networks) {
      const provider = PeyflexProvider.providerForNetwork(net.identifier);
      if (!provider) {
        this.logger.warn(
          `Peyflex data: skipping unknown network "${net.identifier}" (${net.name})`,
        );
        continue;
      }
      const plans = await this.getDataPlans(net.identifier);
      if (plans.length === 0) {
        this.logger.warn(
          `Peyflex data: empty plan list for "${net.identifier}"`,
        );
        continue;
      }
      for (const plan of plans) {
        rows.push({
          provider,
          providerLabel: net.name,
          productCode: plan.planCode,
          vendor: 'peyflex' as const,
          name: cleanDataPlanName(plan.label),
          amount: plan.amount,
          validityDays: dataValidityDays(plan.label, plan.planCode) ?? 30,
          description: `Peyflex \u00b7 ${net.identifier}`,
        });
        this.planPriceCache[plan.planCode] = {
          name: plan.label,
          amount: plan.amount,
        };
      }
    }
    this.planPriceCacheAt = Date.now();
    if (rows.length === 0) {
      this.logger.warn('Peyflex returned no DATA plans');
    }
    return rows;
  }

  // ------------------------------------------------------------------
  // Purchases — data, airtime, electricity.
  // ------------------------------------------------------------------

  /**
   * Resolve the Peyflex data-network id for a DATA order. Rows seeded by this
   * adapter carry `Peyflex · <network>` in their catalog description — prefer
   * it (share / gifting / SME bundles must hit their own network's plan list).
   * Anything else falls back to the standard network id for the provider.
   */
  private static networkIdForDataOrder(order: VendorOrder): string | null {
    const description = String(order.description ?? '');
    const match = description.match(/Peyflex\s*·\s*([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    const providerKey = String(order.provider ?? '').toUpperCase().trim();
    return PeyflexProvider.DEFAULT_NETWORK_BY_PROVIDER[providerKey] ?? null;
  }

  /** POST /api/data/purchase/ — buy a data bundle for a mobile number. */
  async buyData(order: VendorOrder): Promise<VendorResult> {
    if (!this.apiKey) {
      return {
        status: 'failed',
        message:
          'Peyflex is not configured — set PEYFLEX_API_KEY in the backend environment.',
      };
    }
    const network = PeyflexProvider.networkIdForDataOrder(order);
    if (!network) {
      return {
        status: 'failed',
        message: `Peyflex does not support provider "${order.provider}". Supported networks: MTN, GLO, AIRTEL, 9MOBILE.`,
      };
    }
    const planCode = String(order.productCode ?? '').trim();
    const mobile = String(order.phone ?? '').trim();
    if (!planCode) {
      return {
        status: 'failed',
        message: 'No Peyflex plan code was supplied for this data purchase.',
      };
    }
    if (!mobile) {
      return {
        status: 'failed',
        message: 'A recipient phone number is required for the data purchase.',
      };
    }
    try {
      const { data } = await this.client.post(
        '/api/data/purchase/',
        { network, mobile_number: mobile, plan_code: planCode },
        { timeout: 30000 },
      );
      const payload = data ?? {};
      if (PeyflexProvider.isFailed(payload)) {
        return {
          status: 'failed',
          message: PeyflexProvider.messageOf(payload),
        };
      }
      return {
        status: 'success',
        vendorReference: String(
          payload.reference ?? payload.transaction_id ?? order.requestId,
        ),
        providerCost: Number(payload.charged ?? order.amount ?? NaN),
        message: String(payload.message ?? ''),
        meta: {
          network: payload.network ?? network,
          plan: payload.plan ?? planCode,
          balance: payload.balance,
          discount: payload.discount,
          transactionId: payload.transaction_id,
          reference: payload.reference,
        },
      };
    } catch (err: any) {
      if (err?.response?.data) {
        return {
          status: 'failed',
          message: PeyflexProvider.messageOf(err.response.data),
        };
      }
      // Transport error (timeout / dropped connection) — outcome unknown, so let
      // the transactions service keep the order pending for requery.
      throw err;
    }
  }

  /** GET /api/airtime/networks/ — cached briefly; lists every vended network. */
  private async airtimeNetworkList(): Promise<{ id: string; name: string }[]> {
    if (
      this.airtimeNetworks.length > 0 &&
      Date.now() - this.networkCacheAt < PeyflexProvider.NETWORK_CACHE_TTL_MS
    ) {
      return this.airtimeNetworks;
    }
    const { data } = await this.client.get('/api/airtime/networks/', {
      timeout: 30000,
    });
    const payload = data ?? {};
    const list = Array.isArray(payload?.networks) ? payload.networks : [];
    this.airtimeNetworks = list
      .map((n: any) => ({
        id: String(n?.id ?? '').trim(),
        name: String(n?.name ?? '').trim(),
      }))
      .filter((n) => n.id);
    this.networkCacheAt = Date.now();
    return this.airtimeNetworks;
  }

  /**
   * Resolve the Peyflex airtime network id for a catalog product code (mtn,
   * glo, airtel, etisalat/9mobile). Peyflex airtime ids are short slugs, so an
   * exact id match wins; the catalog stores 9mobile airtime as 'etisalat'
   * (VTPass serviceID) so fall back to a network-name match before assuming.
   */
  private async airtimeNetworkId(productCode: string): Promise<string | null> {
    const code = String(productCode ?? '').toLowerCase().trim();
    if (!code) return null;
    const networks = await this.airtimeNetworkList();
    const exact = networks.find((n) => n.id.toLowerCase() === code);
    if (exact) return exact.id;
    const want = code === 'etisalat' || code === '9mobile' ? '9mobile' : code;
    const byName = networks.find((n) => n.name.toLowerCase().includes(want));
    if (byName) return byName.id;
    return code;
  }

  /** POST /api/airtime/topup/ — top up an airtime network for a phone number. */
  async buyAirtime(order: VendorOrder): Promise<VendorResult> {
    if (!this.apiKey) {
      return {
        status: 'failed',
        message:
          'Peyflex is not configured — set PEYFLEX_API_KEY in the backend environment.',
      };
    }
    const network = await this.airtimeNetworkId(order.productCode ?? '');
    if (!network) {
      return {
        status: 'failed',
        message: `Peyflex does not support network "${order.productCode}". Supported networks: MTN, GLO, AIRTEL, 9MOBILE.`,
      };
    }
    const mobile = String(order.phone ?? '').trim();
    const amount = Number(order.amount ?? NaN);
    if (!mobile) {
      return {
        status: 'failed',
        message: 'A recipient phone number is required for the airtime top-up.',
      };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        status: 'failed',
        message: 'A valid amount is required for the airtime top-up.',
      };
    }
    try {
      const { data } = await this.client.post(
        '/api/airtime/topup/',
        { network, amount, mobile_number: mobile },
        { timeout: 30000 },
      );
      const payload = data ?? {};
      if (PeyflexProvider.isFailed(payload)) {
        return {
          status: 'failed',
          message: PeyflexProvider.messageOf(payload),
        };
      }
      return {
        status: 'success',
        vendorReference: String(
          payload.reference ?? payload.transaction_id ?? order.requestId,
        ),
        providerCost: Number(payload.charged ?? order.amount ?? NaN),
        message: String(payload.message ?? ''),
        meta: {
          network: payload.network ?? network,
          amount: payload.amount,
          balance: payload.balance,
          discount: payload.discount,
          transactionId: payload.transaction_id,
          reference: payload.reference,
        },
      };
    } catch (err: any) {
      if (err?.response?.data) {
        return {
          status: 'failed',
          message: PeyflexProvider.messageOf(err.response.data),
        };
      }
      // Transport error — outcome unknown, keep the order pending for requery.
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // Electricity — meter verify + token purchase.
  // ------------------------------------------------------------------

  /**
   * Normalise a catalog disco key (VTPass serviceID, `provider`/`productCode`
   * of the ELECTRICITY catalog rows) to the Peyflex `plan` code. Peyflex uses
   * the same disco code space (Postman examples: `benin-electric`,
   * `kaduna-electric`, `ikeja-electric`) — legacy aliases are folded in for
   * older catalog rows, mirroring the VTPass adapter's alias map.
   */
  private static electricityPlan(discoKey: string): string | null {
    const key = String(discoKey ?? '').toLowerCase().trim();
    if (!key) return null;
    if (PeyflexProvider.DISCO_PLANS[key]) return PeyflexProvider.DISCO_PLANS[key];
    return key;
  }

  private static readonly DISCO_PLANS: Readonly<Record<string, string>> = {
    'ikeja-electric': 'ikeja-electric',
    'eko-electric': 'eko-electric',
    aedc: 'abuja-electric',
    'abuja-electric': 'abuja-electric',
    canedc: 'abuja-electric',
    'kano-electric': 'kano-electric',
    kedco: 'kano-electric',
    phed: 'portharcourt-electric',
    'portharcourt-electric': 'portharcourt-electric',
    'jos-electric': 'jos-electric',
    jedc: 'jos-electric',
    'kaduna-electric': 'kaduna-electric',
    kaedco: 'kaduna-electric',
    'enugu-electric': 'enugu-electric',
    eedc: 'enugu-electric',
    'ibadan-electric': 'ibadan-electric',
    ibedc: 'ibadan-electric',
    'benin-electric': 'benin-electric',
    bedc: 'benin-electric',
    'aba-electric': 'aba-electric',
    'yola-electric': 'yola-electric',
  };

  /**
   * GET /api/electricity/verify/ — resolve a meter number to its customer.
   * Peyflex keys the disco by `plan` and needs the meter `type` (prepaid |
   * postpaid) — both map straight from the platform's verify params
   * (`provider` = disco code, `subType` = meter type).
   */
  async verifyCustomer(params: VerifyParams): Promise<CustomerVerification> {
    if (params.serviceType !== ServiceType.ELECTRICITY) {
      throw new BadRequestException(
        'Customer verification is only supported for electricity by the peyflex provider',
      );
    }
    const plan = PeyflexProvider.electricityPlan(params.provider);
    if (!plan) {
      throw new BadRequestException(
        `Peyflex does not support disco "${params.provider}".`,
      );
    }
    const meter = String(params.identifier ?? '').trim();
    if (!meter) {
      throw new BadRequestException(
        'A meter number is required to verify an electricity meter.',
      );
    }
    const type = String(params.subType ?? 'prepaid').toLowerCase();
    try {
      const { data } = await this.client.get('/api/electricity/verify/', {
        params: { identifier: 'electricity', meter, type, plan },
        timeout: 30000,
      });
      const payload = data ?? {};
      if (PeyflexProvider.isFailed(payload)) {
        throw new BadRequestException(PeyflexProvider.messageOf(payload));
      }
      return {
        name: String(payload.customer_name ?? payload.name ?? 'CUSTOMER'),
        address: payload.address,
        customerRef: String(payload.customer_ref ?? payload.customerRef ?? ''),
        extra: { plan, meterType: type, ...payload },
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      if (err?.response?.data) {
        throw new BadRequestException(PeyflexProvider.messageOf(err.response.data));
      }
      throw err;
    }
  }

  /**
   * POST /api/electricity/subscribe/ — buy electricity tokens for a meter.
   * The platform's order carries the disco in `productCode` and the meter type
   * in `customerData.meterType` (same shape the VTPass adapter consumes).
   */
  async buyElectricity(order: VendorOrder): Promise<VendorResult> {
    if (!this.apiKey) {
      return {
        status: 'failed',
        message:
          'Peyflex is not configured — set PEYFLEX_API_KEY in the backend environment.',
      };
    }
    const plan = PeyflexProvider.electricityPlan(order.productCode ?? '');
    const meter = String(order.meterNumber ?? '').trim();
    const type = String(order.customerData?.meterType ?? 'prepaid').toLowerCase();
    const amount = Number(order.amount ?? NaN);
    if (!plan) {
      return {
        status: 'failed',
        message: `Peyflex does not support disco "${order.productCode}".`,
      };
    }
    if (!meter) {
      return {
        status: 'failed',
        message: 'A meter number is required for the electricity purchase.',
      };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        status: 'failed',
        message: 'A valid amount is required for the electricity purchase.',
      };
    }
    try {
      const { data } = await this.client.post(
        '/api/electricity/subscribe/',
        {
          identifier: 'electricity',
          meter,
          plan,
          amount,
          type,
          phone: String(order.phone ?? ''),
        },
        { timeout: 30000 },
      );
      const payload = data ?? {};
      if (PeyflexProvider.isFailed(payload)) {
        // A 200 FAILED is a definite refusal (also returned for an exhausted
        // voucher balance with a placeholder token) — never deliver it.
        return {
          status: 'failed',
          message: PeyflexProvider.messageOf(payload),
        };
      }
      if (!PeyflexProvider.isOk(payload)) {
        return {
          status: 'pending',
          message: String(
            payload.message ?? 'Peyflex is processing the electricity purchase',
          ),
        };
      }
      return {
        status: 'success',
        vendorReference: String(payload.reference ?? order.requestId),
        providerCost: Number(payload.amount ?? order.amount ?? NaN),
        message: String(payload.message ?? ''),
        meta: {
          token: payload.token,
          mainToken: payload.token,
          meter: payload.meter,
          plan: payload.plan,
          balanceAfter: payload.balance,
          reference: payload.reference,
        },
      };
    } catch (err: any) {
      if (err?.response?.data) {
        return {
          status: 'failed',
          message: PeyflexProvider.messageOf(err.response.data),
        };
      }
      // Transport error — outcome unknown, keep the order pending for requery.
      throw err;
    }
  }

  /**
   * Peyflex has no transaction-status endpoint wired up on this platform — a
   * pending order cannot be confirmed via Requery, so keep it pending (no
   * refund): a delivered token is never refunded and re-triggered.
   */
  async requery(_params: RequeryParams): Promise<VendorResult> {
    return {
      status: 'pending',
      message:
        'Peyflex has no transaction-status endpoint configured on this platform — keep this order pending or contact Peyflex support if it does not settle.',
    };
  }

  /**
   * Peyflex has no price lookup endpoint; return the plan amount captured during
   * the last DATA sync (source of live margins on the admin Profits page — same
   * best-effort behaviour as the other catalogue-backed adapters).
   */
  async getProviderPrice(item: ProviderPriceItem): Promise<number | null> {
    if (item.serviceType !== ServiceType.DATA) return null;
    if (Date.now() - this.planPriceCacheAt > PeyflexProvider.NETWORK_CACHE_TTL_MS) {
      this.planPriceCache = {};
    }
    const plan = this.planPriceCache[String(item.productCode ?? '')];
    return plan ? plan.amount : null;
  }

  private unsupported(service: ServiceType): VendorResult {
    return {
      status: 'failed',
      message: `${service} purchases are not supported by the peyflex provider — peyflex vends airtime, data bundles and electricity on this platform.`,
    };
  }

  async buyCable(order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.CABLE);
  }

  async buyWaec(order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.WAEC);
  }

  async buySms(order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.SMS);
  }
}