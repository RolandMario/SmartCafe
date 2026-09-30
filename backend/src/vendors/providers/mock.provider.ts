import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceType } from '../../common/enums';
import {
  CableCurrentPlan,
  CustomerVerification,
  ProviderPriceItem,
  RequeryParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
} from '../vendor-provider.interface';
import { normalizeCablePlan } from './cable-verify.helper';

/**
 * Simulated vendor used for local development and demos.
 * Produces realistic tokens / PINs / serials so the whole platform
 * can be exercised without live VTPass credentials.
 */
@Injectable()
export class MockProvider implements VendorProvider, OnModuleInit {
  readonly name = 'mock';

  /** Simulated current-plan catalogue — codes/amounts mirror the CABLE seed
   *  (dstv-padi … dstv7, gotv-smallie … gotv-supa, StarTimes dish/antenna) so a
   *  verified customer's plan always maps to a real catalog row via the cable
   *  service and the Renew button has a package to purchase. */
  private static readonly CABLE_PLAN_CATALOG: Record<
    string,
    { code: string; name: string; amount: number }[]
  > = {
    DSTV: [
      { code: 'dstv-padi', name: 'DStv Padi', amount: 4400 },
      { code: 'dstv-yanga', name: 'DStv Yanga', amount: 6000 },
      { code: 'dstv-confam', name: 'DStv Confam', amount: 11000 },
      { code: 'dstv79', name: 'DStv Compact', amount: 19000 },
      { code: 'dstv7', name: 'DStv Compact Plus', amount: 30000 },
    ],
    GOTV: [
      { code: 'gotv-smallie', name: 'GOtv Smallie', amount: 1900 },
      { code: 'gotv-jinja', name: 'GOtv Jinja', amount: 3900 },
      { code: 'gotv-jolli', name: 'GOtv Jolli', amount: 5800 },
      { code: 'gotv-max', name: 'GOtv Max', amount: 8500 },
      { code: 'gotv-supa', name: 'GOtv Supa', amount: 11400 },
    ],
    STARTIMES: [
      { code: 'nova', name: 'StarTimes Nova (Dish)', amount: 2100 },
      { code: 'basic', name: 'StarTimes Basic (Antenna)', amount: 4000 },
      { code: 'smart', name: 'StarTimes Basic (Dish)', amount: 5100 },
      { code: 'classic', name: 'StarTimes Classic (Antenna)', amount: 6000 },
    ],
  };
  readonly supportedServices: ServiceType[] = [
    ServiceType.AIRTIME,
    ServiceType.DATA,
    ServiceType.CABLE,
    ServiceType.ELECTRICITY,
    ServiceType.WAEC,
    ServiceType.JAMB,
    ServiceType.SMS,
  ];
  private readonly logger = new Logger(MockProvider.name);
  private failureRate = 0;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.failureRate = Number(this.config.get('MOCK_FAILURE_RATE', 0)) || 0;
  }

  private randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private delay(ms = 700) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private maybeFail(): { status: 'failed'; message: string } | null {
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      return { status: 'failed', message: 'Vendor simulation: downstream provider error' };
    }
    return null;
  }

  /** Simulated vendor cost: the provider charges 2% below the sales price. */
  private vendorCost(order: VendorOrder): number | undefined {
    const amount = Number(order.amount ?? NaN);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    return Math.round(amount * 0.98 * 100) / 100;
  }

  async getProviderPrice(item: ProviderPriceItem): Promise<number | null> {
    // Simulate the vendor's price as a 2% discount on the sales price.
    const base = item.amount ?? item.unitPrice;
    if (base == null || !Number.isFinite(base) || base <= 0) return null;
    return Math.round(base * 0.98 * 100) / 100;
  }

  private token(segments = 4, len = 4): string {
    const parts = Array.from({ length: segments }, () =>
      Array.from({ length: len }, () => this.randomInt(0, 9)).join(''),
    );
    return parts.join('-');
  }

  private pin(): string {
    return `P${Array.from({ length: 4 }, () => this.randomInt(0, 9)).join('')}`;
  }

  private serial(): string {
    return `WAEC-${Array.from({ length: 4 }, () => this.randomInt(1000, 9999)).join('-')}`;
  }

  private jambPin(): string {
    // VTPass JAMB deliveries are a single 16-digit numeric PIN.
    return Array.from({ length: 16 }, () => this.randomInt(0, 9)).join('');
  }

  private hashIdentifiers(identifier: string): string {
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
      hash = (hash << 5) - hash + identifier.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString();
  }

  private customerName(identifier: string): string {
    const names = ['ADEBAYO OJO', 'CHINWE OKAFOR', 'MUSA IBRAHIM', 'NGOZI EZE', 'TUNDE ADEOYE', 'FATIMA BELLO'];
    const idx = Number(this.hashIdentifiers(identifier).slice(0, 2)) % names.length;
    return names[idx];
  }

  /** Deterministic "current subscription" for a smart card — plan, due date (14
   *  days out) and renewal amount, shaped like VTPass's DSTV verify payload. */
  private currentCablePlan(provider: string, identifier: string): CableCurrentPlan {
    const key = provider.toUpperCase();
    const plans = MockProvider.CABLE_PLAN_CATALOG[key] ?? MockProvider.CABLE_PLAN_CATALOG.DSTV;
    const plan = plans[Number(this.hashIdentifiers(identifier).slice(0, 2)) % plans.length];
    const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    return { productCode: plan.code, name: plan.name, dueDate, amount: plan.amount };
  }

  async buyAirtime(order: VendorOrder): Promise<VendorResult> {
    await this.delay();
    const fail = this.maybeFail();
    if (fail) return fail;
    return {
      status: 'success',
      vendorReference: `MOCK-AIRTIME-${order.requestId.slice(0, 8)}`,
      commission: Math.round((order.amount ?? 0) * 0.02),
      providerCost: this.vendorCost(order),
      meta: {
        phone: order.phone,
        network: order.productCode,
        message: `Airtime of ₦${order.amount} delivered to ${order.phone}`,
      },
    };
  }

  async buyData(order: VendorOrder): Promise<VendorResult> {
    await this.delay(900);
    const fail = this.maybeFail();
    if (fail) return fail;
    return {
      status: 'success',
      vendorReference: `MOCK-DATA-${order.requestId.slice(0, 8)}`,
      commission: Math.round((order.amount ?? 0) * 0.03),
      providerCost: this.vendorCost(order),
      meta: {
        phone: order.phone,
        plan: order.productCode,
        message: `Data subscription of ₦${order.amount} activated on ${order.phone}`,
      },
    };
  }

  async buyCable(order: VendorOrder): Promise<VendorResult> {
    await this.delay(900);
    const fail = this.maybeFail();
    if (fail) return fail;
    const name = this.customerName(order.smartCardNumber ?? '');
    return {
      status: 'success',
      vendorReference: `MOCK-CABLE-${order.requestId.slice(0, 8)}`,
      commission: Math.round((order.amount ?? 0) * 0.025),
      providerCost: this.vendorCost(order),
      meta: {
        smartCardNumber: order.smartCardNumber,
        package: order.productCode,
        customerName: name,
        message: `${order.productCode} activated on smartcard ${order.smartCardNumber}`,
      },
    };
  }

  async buyElectricity(order: VendorOrder): Promise<VendorResult> {
    await this.delay(1200);
    const fail = this.maybeFail();
    if (fail) return fail;
    const customerName = this.customerName(order.meterNumber ?? '');
    const units = Math.floor((order.amount ?? 0) / 15.2);
    return {
      status: 'success',
      vendorReference: `MOCK-ELE-${order.requestId.slice(0, 8)}`,
      providerCost: this.vendorCost(order),
      meta: {
        meterNumber: order.meterNumber,
        meterType: order.customerData?.meterType ?? 'prepaid',
        customerName,
        address: `12 Test Avenue, ${order.productCode}`,
        token: this.token(6),
        units,
        amount: order.amount,
        message: 'Token generated successfully',
      },
    };
  }

  async buyWaec(order: VendorOrder): Promise<VendorResult> {
    await this.delay(1100);
    const fail = this.maybeFail();
    if (fail) return fail;
    const quantity = Math.max(1, Math.min(10, order.quantity ?? 1));
    if (order.productCode === 'waec-registration') {
      return {
        status: 'success',
        vendorReference: `MOCK-WAEC-${order.requestId.slice(0, 8)}`,
        providerCost: this.vendorCost(order),
        meta: {
          product: 'WAEC Registration',
          quantity,
          pins: Array.from({ length: quantity }, () => this.pin()),
          serials: Array.from({ length: quantity }, () => this.serial()),
          message: `${quantity} registration PIN${quantity > 1 ? 's' : ''} generated successfully`,
        },
      };
    }
    return {
      status: 'success',
      vendorReference: `MOCK-WAEC-${order.requestId.slice(0, 8)}`,
      providerCost: this.vendorCost(order),
      meta: {
        product: 'WAEC Result Checker PIN',
        quantity,
        pin: this.pin(),
        serial: this.serial(),
        message: 'Result checker PIN generated successfully',
      },
    };
  }

  async buyJamb(order: VendorOrder): Promise<VendorResult> {
    await this.delay(1000);
    const fail = this.maybeFail();
    if (fail) return fail;
    const product =
      order.productCode === 'utme-mock'
        ? 'UTME PIN (with mock)'
        : 'UTME PIN (without mock)';
    return {
      status: 'success',
      vendorReference: `MOCK-JAMB-${order.requestId.slice(0, 8)}`,
      providerCost: this.vendorCost(order),
      meta: {
        productName: product,
        profileId: order.customerData?.profileId,
        pin: this.jambPin(),
        message: 'JAMB PIN generated successfully',
      },
    };
  }

  async buySms(order: VendorOrder): Promise<VendorResult> {
    await this.delay();
    const fail = this.maybeFail();
    if (fail) return fail;
    const recipients = order.recipients ?? [];
    // Mirror the ebulksms billing model: 1 unit per recipient per 160-char page.
    const pages = Math.max(1, Math.ceil((order.message ?? '').length / 160));
    const units = recipients.length * pages;
    return {
      status: 'success',
      vendorReference: `MOCK-SMS-${order.requestId.slice(0, 8)}`,
      providerCost: this.vendorCost(order),
      meta: {
        senderName: order.senderName,
        units,
        pages,
        recipients: recipients.length,
        message: `${units} SMS units sent (${pages} page(s) per recipient)`,
      },
    };
  }

  async verifyCustomer(params: {
    serviceType: ServiceType;
    provider: string;
    identifier: string;
    subType?: string;
  }): Promise<CustomerVerification> {
    await this.delay(600);
    const name = this.customerName(params.identifier);
    if (params.serviceType === ServiceType.JAMB) {
      return {
        name,
        customerRef: `JAMB-${this.hashIdentifiers(params.identifier).slice(0, 8)}`,
        extra: { profileId: params.identifier, type: params.subType },
      };
    }
    if (params.serviceType === ServiceType.ELECTRICITY) {
      return {
        name,
        address: `23 Power Street, ${params.provider}`,
        customerRef: `EL-${this.hashIdentifiers(params.identifier).slice(0, 8)}`,
        extra: { meterType: params.subType ?? 'prepaid' },
      };
    }
    if (params.serviceType === ServiceType.CABLE) {
      const plan = this.currentCablePlan(params.provider, params.identifier);
      // Mirror VTPass's LIVE /merchant-verify payload (Current_Bouquet* shape) —
      // NOT the older Product_* shape — so the mock exercises the exact field
      // mapping production relies on (normalizeCablePlan), including the
      // UNKNOWN-code fallback and the name price-token cleanup.
      const raw = {
        Customer_Name: name,
        Status: 'ACTIVE',
        Current_Bouquet: plan.name,
        Current_Bouquet_Code: plan.productCode,
        Current_Bouquet_Price: String(plan.amount),
        Due_Date: plan.dueDate,
        Renewal_Amount: String(plan.amount),
        Customer_Type: params.provider.toUpperCase(),
        Customer_Number: params.identifier,
      };
      return {
        name,
        customerRef: `CS-${this.hashIdentifiers(params.identifier).slice(0, 8)}`,
        extra: {
          ...raw,
          // Derived through the same normaliser VTPass uses so the mock and
          // production can never drift apart.
          currentPlan: normalizeCablePlan(raw),
        },
      };
    }
    return {
      name,
      customerRef: `CS-${this.hashIdentifiers(params.identifier).slice(0, 8)}`,
    };
  }

  async requery(params: RequeryParams): Promise<VendorResult> {
    await this.delay(400);
    return {
      status: 'success',
      vendorReference: `MOCK-RQ-${params.requestId.slice(0, 8)}`,
      message: 'Requery: transaction confirmed as successful on vendor side',
    };
  }

  async getBalance(): Promise<{ balance: number; currency: string }> {
    return { balance: 1000000, currency: 'NGN' };
  }
}