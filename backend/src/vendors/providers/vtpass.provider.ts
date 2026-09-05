import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ServiceType } from '../../common/enums';
import {
  CustomerVerification,
  ProviderPriceItem,
  RequeryParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
  VendorStatus,
} from '../vendor-provider.interface';

/**
 * VTPass provider adapter. Covers all platform services:
 * airtime, data, cable (DSTV/GOTV/StarTimes), electricity
 * (all Nigerian discos), WAEC result checker & registration,
 * and bulk SMS via the VTPass messaging API.
 *
 * Swap into production by setting VENDOR_PROVIDER=vtpass and
 * supplying VTPASS_API_KEY / VTPASS_SECRET_KEY / VTPASS_PUBLIC_KEY.
 *
 * VTPass authenticates with custom request headers, NOT HTTP Basic auth:
 *   POST requests -> api-key + secret-key
 *   GET  requests -> api-key + public-key
 */
@Injectable()
export class VtpassProvider implements VendorProvider {
  readonly name = 'vtpass';
  readonly supportedServices: ServiceType[] = [
    ServiceType.AIRTIME,
    ServiceType.DATA,
    ServiceType.CABLE,
    ServiceType.ELECTRICITY,
    ServiceType.WAEC,
    ServiceType.JAMB,
    ServiceType.SMS,
  ];
  private readonly logger = new Logger(VtpassProvider.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;

  /** Codes that mean the transaction is still in progress → keep pending and requery. */
  private static readonly PENDING_CODES = new Set(['001', '044', '099', '089']);

  /** Codes that mean the transaction was NOT created / rejected → mark failed + refund. */
  private static readonly FAILURE_CODES = new Set([
    '010', '011', '012', '013', '016', '017', '018', '019', '020', // args/variation/amount/wallet failures
    '021', '022', '023', '024', '025', '026', '027', '028', // account / whitelist failures
    '030', '031', '032', '034', '035', '040', '083', '085', '087', '091', // biller/other failures
  ]);

  /**
   * Authoritative VTPass electricity service IDs (from VTPass's own catalog/docs).
   * Legacy short disco keys from older catalog seeds are normalised to the real
   * serviceID so variation lookups (prepaid/postpaid) resolve correctly.
   */
  private static readonly ELECTRICITY_SERVICE_IDS: Record<string, string> = {
    'ikeja-electric': 'ikeja-electric', // IKEDC
    'eko-electric': 'eko-electric', // EKEDC
    'aedc': 'abuja-electric', // AEDC
    'abuja-electric': 'abuja-electric',
    'canedc': 'abuja-electric', // AEDC legacy alias
    'kano-electric': 'kano-electric', // KEDCO
    'kedco': 'kano-electric', // KEDCO legacy alias
    'phed': 'portharcourt-electric', // PHED
    'portharcourt-electric': 'portharcourt-electric',
    'jos-electric': 'jos-electric', // JED
    'jedc': 'jos-electric', // JED legacy alias
    'kaduna-electric': 'kaduna-electric', // KAEDCO
    'kaedco': 'kaduna-electric', // KAEDCO legacy alias
    'enugu-electric': 'enugu-electric', // EEDC
    'eedc': 'enugu-electric', // EEDC legacy alias
    'ibadan-electric': 'ibadan-electric', // IBEDC
    'ibedc': 'ibadan-electric', // IBEDC legacy alias
    'benin-electric': 'benin-electric', // BEDC
    'bedc': 'benin-electric', // BEDC legacy alias
    'aba-electric': 'aba-electric', // APLE
    'yola-electric': 'yola-electric', // YEDC
  };

  private electricityServiceId(code?: string): string {
    const key = String(code ?? '').toLowerCase();
    return VtpassProvider.ELECTRICITY_SERVICE_IDS[key] ?? key;
  }

  /**
   * Data is vended under vendor-specific service IDs (NOT the airtime IDs).
   * The catalog product codes don't share a single shape — mtn-10mb-100,
   * glo100, airt-100, eti-100 — so match the leading network token explicitly.
   * (Verified against VTPass /service-variations: 9mobile-data does NOT exist,
   * the real 9mobile serviceID is etisalat-data with eti-* variations.)
   *   mtn*    -> mtn-data
   *   glo*    -> glo-data
   *   airt*   -> airtel-data
   *   eti*    -> etisalat-data  (9mobile)
   */
  private dataServiceId(code?: string): string {
    const key = String(code ?? '').toLowerCase();
    const DATA_SERVICE_IDS: ReadonlyArray<readonly [string, string]> = [
      ['mtn', 'mtn-data'],
      ['glo', 'glo-data'],
      ['airt', 'airtel-data'],
      ['eti', 'etisalat-data'],
      ['9mobile', 'etisalat-data'],
    ];
    const match = DATA_SERVICE_IDS.find(([prefix]) => key.startsWith(prefix));
    return match ? match[1] : `${key.split('-')[0] || ''}-data`;
  }

  /** Cable plans are vended under VTPass serviceIDs dstv / gotv / startimes. */
  private cableServiceId(code?: string): string {
    const key = String(code ?? '').toLowerCase();
    return { dstv: 'dstv', gotv: 'gotv', startimes: 'startimes' }[key] ?? 'dstv';
  }

  /**
   * VTPass exposes WAEC via two serviceIDs, each with its own variation list.
   * The catalog productCodes are internal identifiers — map them to the VTPass
   * serviceID + variation_code so price lookups resolve correctly.
   */
  private static readonly WAEC_VARIATIONS: Record<
    string,
    { serviceID: string; variationCode: string }
  > = {
    'waec-result-checker': { serviceID: 'waec', variationCode: 'waecdirect' },
    'waec-registration': { serviceID: 'waec-registration', variationCode: 'waec-registraion' },
  };

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get<string>('VTPASS_BASE_URL', '');
    const apiKey = this.config.get<string>('VTPASS_API_KEY', '');
    const secretKey = this.config.get<string>('VTPASS_SECRET_KEY', '');
    const publicKey = this.config.get<string>('VTPASS_PUBLIC_KEY', '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      // VTPass can take 30-60s+ to settle a request. Keep the client waiting
      // here instead of failing the buy; if it does time out the transaction
      // is kept 'pending' and resolved via requery (VTPass' documented flow).
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' },
    });
    // VTPass requires these custom headers on every request (Basic auth is rejected):
    //   POST requests -> api-key + secret-key
    //   GET  requests -> api-key + public-key
    this.client.interceptors.request.use((config) => {
      const method = (config.method ?? 'get').toLowerCase();
      config.headers.set('api-key', apiKey);
      config.headers.set(
        method === 'get' ? 'public-key' : 'secret-key',
        method === 'get' ? publicKey : secretKey,
      );
      return config;
    });
  }

  private mapResult(payload: any): VendorResult {
    const code = String(payload?.code ?? '').trim();
    const responseDesc = String(payload?.response_description ?? payload?.message ?? '');
    const content = payload?.content ?? {};
    const txn = content?.transactions ?? {};
    const txnStatus = String(txn?.status ?? '').toLowerCase().trim();

    // WAEC deliveries carry the PIN(s) in the response root, not in transactions:
    //   result checker  -> cards: [{ Serial, Pin }]
    //   registration    -> tokens: ["0100070365657400875", ...] (one per PIN bought)
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
    const pins = [
      ...cards.map((c: any) => String(c?.Pin ?? c?.pin ?? '').trim()),
      ...tokens.map((t: any) => String(t ?? '').trim()),
    ].filter((p) => p.length > 0);
    const serials = cards
      .map((c: any) => String(c?.Serial ?? c?.serial ?? '').trim())
      .filter((s) => s.length > 0);

    let status: VendorStatus;
    if (code === '000') {
      // 000 = processed. The true state lives in content.transactions.status.
      if (txnStatus === 'delivered') status = 'success';
      else if (txnStatus === '' || txnStatus === 'pending' || txnStatus === 'initiated') {
        status = 'pending';
      } else if (/fail|error/.test(txnStatus)) {
        status = 'failed';
      } else {
        status = 'pending'; // unknown inner status → requery to confirm
      }
    } else if (VtpassProvider.FAILURE_CODES.has(code)) {
      // Definite rejection — VTPass did NOT create a transaction.
      status = 'failed';
    } else if (VtpassProvider.PENDING_CODES.has(code)) {
      status = 'pending';
    } else if (
      /fail|error|invalid|insufficient|not processed|not reachable|suspended|locked|whitelist/i.test(
        responseDesc,
      )
    ) {
      status = 'failed';
    } else {
      // Unexpected response → keep pending (VTPass docs: treat as pending & requery).
      status = 'pending';
    }

    // Electricity (prepaid meter) responses carry the actual recharge token in
    // `content.transactions.mainToken` (sometimes `main_token`), with optional
    // bonus/balance tokens, and `purchased_code` at the response root. The
    // `unique_element.value` is the vend reference, NOT the token users key into
    // their meter — so prefer mainToken and keep the legacy value as a fallback.
    const mainToken = String(
      txn?.mainToken ??
        txn?.main_token ??
        txn?.token ??
        payload?.purchased_code ??
        payload?.purchasedCode ??
        '',
    ).trim();
    const bonusToken = String(txn?.bonusToken ?? txn?.bonus_token ?? '').trim();
    const balanceToken = String(txn?.balanceToken ?? txn?.balance_token ?? '').trim();
    const legacyToken = String(txn?.unique_element?.value ?? '').trim();
    const token = mainToken || legacyToken;

    // JAMB deliveries carry the PIN at the response root as `Pin` / `purchased_code`
    // (formatted "Pin : 3678251321392432"). Normalise it so receipts show clean digits.
    const jambPin = String(payload?.Pin ?? payload?.pin ?? '')
      .replace(/^Pin\s*:\s*/i, '')
      .trim();

    // The amount VTPass actually charged for this order — the true vendor debit
    // (sales price − our profit). It lives in `content.transactions.{amount,
    // total_amount, unit_price × quantity}`, with the payload root as a fallback.
    const unitPrice = Number(txn?.unit_price ?? txn?.unitPrice ?? NaN);
    const txnQuantity = Number(txn?.quantity ?? NaN);
    const chargedCandidates = [
      txn?.amount,
      txn?.total_amount,
      txn?.totalAmount,
      Number.isFinite(unitPrice) && (Number.isFinite(txnQuantity) ? unitPrice * (txnQuantity || 1) : unitPrice),
      payload?.amount,
    ]
      .map((v) => Number(v ?? NaN))
      .filter((v) => Number.isFinite(v) && v > 0);
    const providerCost =
      chargedCandidates.length > 0 ? Math.round(chargedCandidates[0] * 100) / 100 : undefined;

    return {
      status,
      vendorReference: payload?.requestId ?? payload?.request_id ?? txn?.product_name,
      message: responseDesc,
      commission: Number(content?.commission ?? 0) || undefined,
      ...(providerCost !== undefined ? { providerCost } : {}),
      meta: {
        ...(token ? { token } : {}),
        ...(mainToken ? { mainToken } : {}),
        ...(bonusToken ? { bonusToken } : {}),
        ...(balanceToken ? { balanceToken } : {}),
        // A single PIN/serial maps to the legacy single fields; multiple to arrays.
        ...(pins.length === 1 ? { pin: pins[0], ...(serials[0] ? { serial: serials[0] } : {}) } : {}),
        ...(pins.length > 1 ? { pins, ...(serials.length ? { serials } : {}) } : {}),
        // JAMB vends a single PIN directly in the response root.
        ...(jambPin ? { pin: jambPin } : {}),
        ...(txn?.quantity != null ? { quantity: Number(txn.quantity) } : {}),
        code,
        productName: txn?.product_name,
        customerName: txn?.unique_element?.name,
        customerAddress: txn?.unique_element?.address,
      },
    };
  }

  private async pay(
    order: VendorOrder,
    serviceID: string,
    billersCode?: string,
    options: { omitAmount?: boolean; subscriptionType?: string; variationCode?: string } = {},
  ): Promise<VendorResult> {
    const body: Record<string, any> = {
      request_id: order.requestId,
      serviceID,
      phone: order.phone,
      // Most services (data, cable, airtime) use the product code as the VTPass
      // variation. Electricity is the exception: VTPass expects the METER TYPE
      // ("prepaid" | "postpaid") as the variation_code, so callers override it.
      variation_code: options.variationCode ?? order.productCode ?? '',
    };
    if (options.omitAmount !== true && order.amount != null) body.amount = order.amount;
    if (billersCode) body.billersCode = billersCode;
    if (options.subscriptionType) body.subscription_type = options.subscriptionType;
    // WAEC registration / result checker: buy several PINs in one request.
    if (order.quantity != null && order.quantity >= 1) body.quantity = order.quantity;
    const { data } = await this.client.post('/pay', body);
    return this.mapResult(data);
  }

  async buyAirtime(order: VendorOrder): Promise<VendorResult> {
    // Airtime is vended under VTPass serviceIDs, NOT the raw catalog product
    // code. The catalog stores 9mobile as 'etisalat', but older seeds / admin
    // records may still carry '9mobile' — a serviceID VTPass rejects with
    // "product does not exist" ("Service is Not Valid"). Normalise explicitly:
    //   mtn      -> mtn
    //   glo      -> glo
    //   airtel   -> airtel
    //   etisalat -> etisalat      (9mobile)
    //   9mobile  -> etisalat      (VTPass has no '9mobile' airtime service)
    const code = (order.productCode || '').toLowerCase();
    const AIRTIME_SERVICE_IDS: ReadonlyArray<readonly [string, string]> = [
      ['mtn', 'mtn'],
      ['glo', 'glo'],
      ['airtel', 'airtel'],
      ['etisalat', 'etisalat'],
      ['9mobile', 'etisalat'],
    ];
    const match = AIRTIME_SERVICE_IDS.find(([prefix]) => code.startsWith(prefix));
    const serviceID = match ? match[1] : code;
    return this.pay({ ...order, productCode: serviceID }, serviceID);
  }

  async buyData(order: VendorOrder): Promise<VendorResult> {
    const serviceID = this.dataServiceId(order.productCode);
    // Data bundles are fixed-price variations — let VTPass use the variation price.
    return this.pay(order, serviceID, undefined, { omitAmount: true });
  }

  async buyCable(order: VendorOrder): Promise<VendorResult> {
    const serviceID = this.cableServiceId(order.productCode);
    // VTPass documents `subscription_type: renew` as mandatory for cable renewals.
    return this.pay(order, serviceID, order.smartCardNumber, { subscriptionType: 'renew' });
  }

  async buyElectricity(order: VendorOrder): Promise<VendorResult> {
    // VTPass electricity `/pay` contract:
    //   serviceID      = disco service ID e.g. "ikeja-electric" / "abuja-electric"
    //   billersCode    = meter number
    //   variation_code = meter type ("prepaid" | "postpaid") — NOT the disco code
    const serviceID = this.electricityServiceId(order.productCode);
    return this.pay(order, serviceID, order.meterNumber, {
      variationCode: String(order.customerData?.meterType ?? ''),
    });
  }

  async buyWaec(order: VendorOrder): Promise<VendorResult> {
    // VTPass exposes two separate WAEC services, each with its own variation list.
    // The catalog product codes are NOT the variation codes VTPass knows, so map
    // them explicitly (verified via GET /service-variations on sandbox):
    //   serviceID `waec`               (result checker) -> variation_code `waecdirect` (WASSCE/GCE)
    //   serviceID `waec-registration`  (registration)   -> variation_code `waec-registraion` (sic, VTPass typo)
    const isRegistration = order.productCode === 'waec-registration';
    const serviceID = isRegistration ? 'waec-registration' : 'waec';
    const variationCode = isRegistration ? 'waec-registraion' : 'waecdirect';
    return this.pay(order, serviceID, undefined, { variationCode });
  }

  async buyJamb(order: VendorOrder): Promise<VendorResult> {
    // VTPass JAMB pin-vending contract (https://vtpass.com/documentation/jamb-pin-vending-api/):
    //   serviceID      = jamb
    //   variation_code = utme-mock | utme-no-mock  (the catalog product code IS the variation)
    //   billersCode    = the JAMB profile ID (gotten from the JAMB portal)
    //   amount         = the variation amount (fixed price, set from the catalog)
    return this.pay(order, 'jamb', order.customerData?.profileId ?? '', {
      variationCode: order.productCode ?? '',
    });
  }

  async buySms(order: VendorOrder): Promise<VendorResult> {
    // VTPass messaging API (normal sender-ID SMS)
    const { data } = await this.client.post('/sms/send', {
      sender: order.senderName,
      message: order.message,
      recipients: order.recipients,
      client_ref: order.requestId,
    });
    const success = String(data?.code ?? '') === '000' || Array.isArray(data?.response);
    return {
      status: success ? 'success' : 'pending',
      vendorReference: order.requestId,
      meta: { units: order.recipients?.length ?? 0, recipients: order.recipients?.length ?? 0 },
    };
  }

  async getProviderPrice(item: ProviderPriceItem): Promise<number | null> {
    const code = item.productCode ?? '';
    let serviceID: string;
    let variationCode: string;

    switch (item.serviceType) {
      case ServiceType.DATA: {
        serviceID = this.dataServiceId(code);
        variationCode = code;
        break;
      }
      case ServiceType.CABLE: {
        serviceID = this.cableServiceId(code);
        variationCode = code;
        break;
      }
      case ServiceType.WAEC: {
        const waec = VtpassProvider.WAEC_VARIATIONS[code];
        if (!waec) return null;
        serviceID = waec.serviceID;
        variationCode = waec.variationCode;
        break;
      }
      case ServiceType.JAMB: {
        serviceID = 'jamb';
        variationCode = code;
        break;
      }
      default:
        // Airtime and electricity are variable-amount services — no fixed price.
        return null;
    }

    const variations = await this.getVariations(serviceID);
    const match = variations.find((v) => v.variationCode === variationCode);
    return match ? match.variationAmount : null;
  }

  /** Fetch the current price catalogue for a VTPass service (GET /service-variations). */
  private async getVariations(
    serviceID: string,
  ): Promise<{ variationCode: string; variationAmount: number; productName?: string }[]> {
    try {
      const { data } = await this.client.get('/service-variations', {
        params: { serviceID },
        timeout: 15000,
      });
      const variations = data?.content?.variations ?? [];
      return variations
        .map((v: any) => ({
          variationCode: String(v?.variation_code ?? v?.variationCode ?? '').trim(),
          variationAmount: Number(v?.variation_amount ?? v?.variationAmount ?? NaN),
          productName: v?.variation_name ?? v?.name,
        }))
        .filter(
          (v: { variationCode: string; variationAmount: number }) =>
            v.variationCode && Number.isFinite(v.variationAmount) && v.variationAmount > 0,
        );
    } catch (err: any) {
      this.logger.warn(
        `VTPass service-variations (${serviceID}) failed: ${String(err?.message ?? err)}`,
      );
      return [];
    }
  }

  async verifyCustomer(params: {
    serviceType: ServiceType;
    provider: string;
    identifier: string;
    subType?: string;
  }): Promise<CustomerVerification> {
    // VTPass `/merchant-verify` contract:
    //   serviceID   = disco service ID e.g. "ikeja-electric" / "abuja-electric"
    //   billersCode = meter number
    //   type        = meter type ("prepaid" | "postpaid") — required for electricity
    const serviceID =
      params.serviceType === ServiceType.ELECTRICITY
        ? this.electricityServiceId(params.provider)
        : params.serviceType === ServiceType.JAMB
          ? 'jamb'
          : params.provider;
    const body: Record<string, string> = {
      serviceID,
      billersCode: params.identifier,
    };
    if (
      (params.serviceType === ServiceType.ELECTRICITY || params.serviceType === ServiceType.JAMB) &&
      params.subType
    ) {
      body.type = params.subType;
    }
    const { data } = await this.client.post('/merchant-verify', body);
    const content = data?.content ?? {};
    return {
      name: content?.Customer_Name ?? content?.name ?? 'CUSTOMER',
      address: content?.Address,
      customerRef: content?.customer_id,
      extra: content,
    };
  }

  async requery(params: RequeryParams): Promise<VendorResult> {
    const { data } = await this.client.post('/requery', { request_id: params.requestId });
    return this.mapResult(data);
  }

  async getBalance(): Promise<{ balance: number; currency: string }> {
    try {
      // GET /api/balance  (requires api-key + public-key headers)
      const { data } = await this.client.get('/balance');
      const balance = Number(
        data?.contents?.balance ?? data?.content?.balance ?? data?.balance ?? 0,
      );
      return { balance: Number.isFinite(balance) ? balance : 0, currency: 'NGN' };
    } catch {
      return { balance: 0, currency: 'NGN' };
    }
  }
}