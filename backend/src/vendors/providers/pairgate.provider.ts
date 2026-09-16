import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ServiceType } from '../../common/enums';
import {
  CustomerVerification,
  RequeryParams,
  VerifyParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
} from '../vendor-provider.interface';
import {
  DataPlanRow,
  PAIRGATE_PROVIDER_LABELS,
  PAIRGATE_PROVIDER_SLUGS,
} from '../../catalog/data-plan-sync';

export interface PairgatePlanCategory {
  providerId: string;
  providerName: string;
  planType: string;
}

export interface PairgatePlan {
  planId: string;
  name: string;
  price: number;
  duration: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pairgate provider adapter — data bundles only (for now).
 *
 * API surface (https://pairgate.com/developers):
 *   - GET  /data-plans/categories  -> plan categories grouped by network
 *   - GET  /data-plans            ?provider_id=<slug>&plan_type=<type>
 *   - POST /data/purchase          { provider_id, plan_id, recipient, reference }
 *   - GET  /wallet/balance
 *
 * Auth is a Bearer token on every request. Pairgate throttles aggressively
 * (~1-2s between requests per key — "Please wait N seconds before retrying"),
 * so catalog reads are paced and retried after the suggested wait.
 *
 * Configure with PAIRGATE_BASE_URL / PAIRGATE_API_KEY. Pin the DATA service to
 * `pairgate` from the admin Vendors page (or set VENDOR_PROVIDER=pairgate) to
 * make it the active data provider.
 */
@Injectable()
export class PairgateProvider implements VendorProvider {
  readonly name = 'pairgate';
  /** Pairgate currently only vends data bundles on this platform. */
  readonly supportedServices: ServiceType[] = [ServiceType.DATA];
  private readonly logger = new Logger(PairgateProvider.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  /** Pacing between catalog requests (Pairgate's rate window is ~1-2s). */
  private static readonly REQUEST_PACING_MS = 3000;
  private static readonly MAX_RETRIES = 6;

  /** Timestamp of the last Pairgate request — used to guarantee pacing. */
  private lastRequestAt = 0;

  constructor(private config: ConfigService) {
    this.baseUrl = String(
      this.config.get<string>('PAIRGATE_BASE_URL') ?? 'https://pairgate.com/api/v1',
    ).replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('PAIRGATE_API_KEY', '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { 'Cache-Control': 'no-cache' },
    });
    this.client.interceptors.request.use((cfg) => {
      cfg.headers.set('Authorization', `Bearer ${this.apiKey}`);
      return cfg;
    });
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Number of seconds Pairgate asks us to wait before retrying, if any. */
  private rateLimitWait(payload: any): number {
    if (!payload || typeof payload !== 'object') return 0;
    const message = String(payload.message ?? '');
    const match = message.match(/wait\s+(\d+)\s+seconds/i);
    if (match) return Number(match[1]);
    const code = Number(payload.code ?? payload.statusCode ?? NaN);
    const status = String(payload.status ?? '');
    // 201/429 error bodies without an explicit wait — take a conservative pause.
    if (status === 'error' && (code === 429 || code === 201)) return 3;
    return 0;
  }

  /** Guarantee at least REQUEST_PACING_MS between two consecutive Pairgate requests. */
  private async pace(): Promise<void> {
    const since = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && since < PairgateProvider.REQUEST_PACING_MS) {
      await delay(PairgateProvider.REQUEST_PACING_MS - since);
    }
    this.lastRequestAt = Date.now();
  }

  /** GET helper with Pairgate rate-limit handling (body reply or HTTP 429). */
  private async apiGet(path: string, params?: Record<string, string>): Promise<any> {
    let attempts = 0;
    while (true) {
      attempts++;
      await this.pace();
      try {
        const { data } = await this.client.get(path, { params, timeout: 20000 });
        const wait = this.rateLimitWait(data);
        if (wait > 0 && attempts < PairgateProvider.MAX_RETRIES) {
          await delay((wait + 1) * 1000);
          continue;
        }
        return data;
      } catch (err: any) {
        const wait =
          this.rateLimitWait(err?.response?.data) ||
          (err?.response?.status === 429 ? 3 : 0);
        if (wait > 0 && attempts < PairgateProvider.MAX_RETRIES) {
          await delay((wait + 1) * 1000);
          continue;
        }
        // Only transient (no server reply) errors are worth retrying.
        if (err?.response || attempts >= PairgateProvider.MAX_RETRIES) throw err;
        await delay(PairgateProvider.REQUEST_PACING_MS * attempts);
      }
    }
  }

  /**
   * GET /data-plans/categories — plan categories grouped by network provider.
   * Note Pairgate returns a provider UUID here; the actual provider *slug*
   * (mtn / airtel / glo / 9mobile) is what /data-plans and /data/purchase want.
   */
  async getDataPlanCategories(): Promise<PairgatePlanCategory[]> {
    const data = await this.apiGet('/data-plans/categories');
    const list = Array.isArray(data?.data) ? data.data : [];
    return list
      .map((c: any) => ({
        providerId: String(c?.provider_id ?? '').trim(),
        providerName: String(c?.provider_name ?? '').trim().toUpperCase(),
        planType: String(c?.plan_type ?? '').trim(),
      }))
      .filter((c) => c.providerName && c.planType);
  }

  /** GET /data-plans — the current plan list for one provider slug + plan type. */
  async getDataPlans(providerId: string, planType: string): Promise<PairgatePlan[]> {
    const data = await this.apiGet('/data-plans', {
      provider_id: providerId,
      plan_type: planType,
    });
    // Pairgate replies keyed by provider name: { "MTN": [ ... ] }.
    const grouped = data?.data ?? {};
    const list = Object.values(grouped)[0];
    const plans = Array.isArray(list) ? list : [];
    return plans
      .map((p: any) => ({
        planId: String(p?.plan_id ?? '').trim(),
        name: String(p?.name ?? '').trim(),
        price: Number(p?.price ?? NaN),
        duration: Number(p?.duration ?? NaN),
      }))
      .filter((p) => p.planId && Number.isFinite(p.price) && p.price > 0);
  }

  private static readonly SLUG_TO_PROVIDER: Readonly<Record<string, string>> = {
    mtn: 'MTN',
    glo: 'GLO',
    airtel: 'AIRTEL',
    '9mobile': '9MOBILE',
  };

  /**
   * Enumerates every available plan across providers × plan types — this is what
   * re-seeds the DATA catalog when pairgate becomes the active data provider.
   * Requests are paced to respect Pairgate's rate limit.
   */
  async fetchAllDataPlans(): Promise<DataPlanRow[]> {
    const categories = await this.getDataPlanCategories();

    // Unique (slug, plan_type) pairs, preserving the API's order.
    const combos: { slug: string; planType: string; providerLabel: string }[] = [];
    const seen = new Set<string>();
    for (const cat of categories) {
      const slug = PAIRGATE_PROVIDER_SLUGS[cat.providerName];
      if (!slug) continue;
      const key = `${slug}:${cat.planType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combos.push({
        slug,
        planType: cat.planType,
        providerLabel:
          PAIRGATE_PROVIDER_LABELS[cat.providerName] ?? cat.providerName,
      });
    }

    const rows: DataPlanRow[] = [];
    for (const combo of combos) {
      // Pacing happens inside apiGet (paces every request + retries).
      try {
        const plans = await this.getDataPlans(combo.slug, combo.planType);
        for (const plan of plans) {
          rows.push({
            provider:
              PairgateProvider.SLUG_TO_PROVIDER[combo.slug] ??
              combo.slug.toUpperCase(),
            providerLabel: combo.providerLabel,
            productCode: plan.planId,
            name: plan.name,
            amount: plan.price,
            validityDays:
              Number.isFinite(plan.duration) && plan.duration > 0
                ? plan.duration
                : 30,
            description: `Pairgate ${combo.planType}`,
          });
        }
      } catch (err: any) {
        this.logger.warn(
          `Pairgate plan fetch ${combo.slug}/${combo.planType} failed: ${String(err?.message ?? err)}`,
        );
      }
    }
    return rows;
  }

  /** POST /data/purchase — buy a data bundle for a mobile number. */
  async buyData(order: VendorOrder): Promise<VendorResult> {
    if (!this.apiKey) {
      return {
        status: 'failed',
        message:
          'Pairgate is not configured — set PAIRGATE_API_KEY in the backend environment.',
      };
    }
    const providerKey = String(order.provider ?? '').toUpperCase().trim();
    const providerId = PAIRGATE_PROVIDER_SLUGS[providerKey];
    if (!providerId) {
      return {
        status: 'failed',
        message: `Pairgate does not support provider "${order.provider}". Supported networks: MTN, GLO, AIRTEL, 9MOBILE.`,
      };
    }
    const planId = String(order.productCode ?? '').trim();
    if (!planId) {
      return {
        status: 'failed',
        message: 'No Pairgate plan id was supplied for this data purchase.',
      };
    }
    const recipient = String(order.phone ?? '').trim();
    if (!recipient) {
      return {
        status: 'failed',
        message: 'A recipient phone number is required for the data purchase.',
      };
    }
    const reference = order.requestId; // unique, 8+ chars — idempotent on Pairgate

    try {
      await this.pace(); // stay inside Pairgate's rate window
      const { data } = await this.client.post(
        '/data/purchase',
        { provider_id: providerId, plan_id: planId, recipient, reference },
        { timeout: 30000 },
      );
      const payload = data?.data ?? {};
      if (data?.status === 'success' && payload?.status === true) {
        return {
          status: 'success',
          vendorReference: String(payload.reference_code ?? reference),
          providerCost: Number(payload.amount ?? order.amount ?? NaN),
          message: String(payload.message ?? ''),
          meta: {
            plan: payload.plan,
            recipient: payload.recipient,
            balanceBefore: payload.balance_before,
            balanceAfter: payload.balance_after,
            referenceCode: payload.reference_code,
          },
        };
      }
      return {
        status: 'failed',
        message: String(
          payload.message ?? data?.message ?? 'Pairgate rejected the data purchase',
        ),
      };
    } catch (err: any) {
      // A server reply is a definite outcome: Pairgate refused the purchase.
      if (err?.response?.data) {
        const body = err.response.data;
        return {
          status: 'failed',
          message: String(
            body?.message ?? body?.error ?? 'Pairgate rejected the data purchase',
          ),
        };
      }
      // Transport error (timeout / dropped connection) — outcome unknown, so let
      // the transactions service keep the order pending for requery.
      throw err;
    }
  }

  /**
   * Pairgate accepts purchases asynchronously ("successful & processing"). A
   * transaction-status endpoint was not wired up yet, so a pending order cannot
   * be confirmed via Requery on this platform — keep it pending (no refund) so
   * a delivered bundle is never refunded and re-triggered.
   */
  async requery(_params: RequeryParams): Promise<VendorResult> {
    return {
      status: 'pending',
      message:
        'Pairgate has no transaction-status endpoint configured on this platform — keep this order pending or contact Pairgate support if it does not settle.',
    };
  }

  /** GET /wallet/balance — remaining Pairgate wallet balance (wholesale credit). */
  async getBalance(): Promise<{ balance: number; currency: string }> {
    if (!this.apiKey) return { balance: 0, currency: 'NGN' };
    try {
      const data = await this.apiGet('/wallet/balance');
      const payload = data?.data ?? {};
      const balance = Number(payload?.balance ?? NaN);
      return {
        balance: Number.isFinite(balance) ? balance : 0,
        currency: String(payload?.currency ?? 'NGN'),
      };
    } catch {
      return { balance: 0, currency: 'NGN' };
    }
  }

  async verifyCustomer(_params: VerifyParams): Promise<CustomerVerification> {
    throw new BadRequestException(
      'Customer verification is not supported by the pairgate provider',
    );
  }

  private unsupported(service: ServiceType): VendorResult {
    return {
      status: 'failed',
      message: `${service} purchases are not supported by the pairgate provider — pairgate only vends data bundles on this platform.`,
    };
  }

  async buyAirtime(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.AIRTIME);
  }

  async buyCable(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.CABLE);
  }

  async buyElectricity(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.ELECTRICITY);
  }

  async buyWaec(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.WAEC);
  }

  async buySms(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.SMS);
  }
}