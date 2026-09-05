import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceType } from '../../common/enums';
import {
  CustomerVerification,
  ProviderPriceItem,
  RequeryParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
} from '../vendor-provider.interface';

/**
 * Simulated vendor used for local development and demos.
 * Produces realistic tokens / PINs / serials so the whole platform
 * can be exercised without live VTPass credentials.
 */
@Injectable()
export class MockProvider implements VendorProvider, OnModuleInit {
  readonly name = 'mock';
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