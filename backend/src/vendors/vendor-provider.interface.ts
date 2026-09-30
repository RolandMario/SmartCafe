import { ServiceType } from '../common/enums';

export interface VendorOrder {
  serviceType: ServiceType;
  /** Idempotency key to safely retry the same purchase */
  requestId: string;
  /** Product / variation code (data plans, cable packages, WAEC product) */
  productCode?: string;
  /** Catalog row description — the Peyflex adapter embeds its data-network id
   *  here (`Peyflex · <network>`) when it seeds DATA plans. */
  description?: string;
  /** Vendor/catalog provider key (e.g. 'MTN', 'GLO') — used by providers whose
   *  APIs key products by network (e.g. pairgate's provider_id slug). */
  provider?: string;
  /** Fulfilling vendor ('pairgate' | 'vtpass'): DATA plans debit THEIR own
   *  vendor's account. Falls back to the pinned DATA provider when absent. */
  vendor?: string;
  amount?: number;
  /** Number of units to buy (WAEC registration PINs etc.). Defaults to 1. */
  quantity?: number;
  phone?: string;
  smartCardNumber?: string;
  meterNumber?: string;
  /** Free-form customer data (WAEC registration details, etc.) */
  customerData?: Record<string, any>;
  /** Bulk SMS payload */
  senderName?: string;
  message?: string;
  recipients?: string[];
}

export type VendorStatus = 'success' | 'failed' | 'pending';

export interface VendorResult {
  status: VendorStatus;
  vendorReference?: string;
  message?: string;
  commission?: number;
  /** The amount the vendor actually charged for this order (the true account debit).
   *  Profit per transaction = sales price (transaction.amount) − providerCost. */
  providerCost?: number;
  /** Token, PIN, serial, customer name, balance etc. */
  meta?: Record<string, any>;
}

/** Input for the optional `VendorProvider.getProviderPrice` call (live-margin lookups). */
export interface ProviderPriceItem {
  serviceType: ServiceType;
  /** Product / variation code (data plans, cable packages, WAEC/JAMB product codes). */
  productCode?: string;
  /** For DATA, the plan's own vendor — routes the price lookup to the right adapter. */
  vendor?: string;
  /** Sales-side price — the provider may fall back on it when its catalogue has no entry. */
  amount?: number;
  /** Per-unit sales price (SMS etc.). */
  unitPrice?: number;
}

export interface CustomerVerification {
  name: string;
  address?: string;
  customerRef?: string;
  extra?: Record<string, any>;
}

/**
 * The customer's current cable plan returned by verification, normalised from
 * the vendor's raw /merchant-verify payload (VTPass returns flat Customer_Name /
 * Product_Code / Product_Name / Due_Date / Renewal_Amount fields for DSTV,
 * while GOTV/StarTimes nest the active product). Surfaced to the mobile app so
 * the cable purchase screen can render a "Renew" button for the exact plan the
 * customer is already on.
 */
export interface CableCurrentPlan {
  /** VTPass variation_code of the customer's current plan (e.g. 'dstv-confam'). */
  productCode?: string;
  /** Plan display name (e.g. 'DStv Confam'). */
  name: string;
  /** Subscription expiry / due date, as returned by the vendor. */
  dueDate?: string;
  /** Renewal amount in naira — from the vendor or our catalog. */
  amount?: number;
}

/** Catalog-matched package for the customer's current plan — what "Renew" buys. */
export interface CableRenewal {
  /** Catalog item _id — the exact `packageId` the purchase endpoint expects. */
  packageId: string;
  productCode: string;
  name: string;
  /** Sales price in naira (catalog amount, falling back to the vendor's renewal amount). */
  amount: number;
  /** Cashback / commission config for this plan. */
  commission: number;
}

export interface VerifyParams {
  serviceType: ServiceType;
  provider: string;
  identifier: string;
  /** e.g. prepaid | postpaid for electricity */
  subType?: string;
}

export interface VendorBalance {
  balance: number;
  currency: string;
}

export interface RequeryParams {
  serviceType: ServiceType;
  requestId: string;
}

export interface VendorProvider {
  readonly name: string;

  /** Services this provider can actually fulfil (drives the admin UI warnings). */
  readonly supportedServices: ServiceType[];

  /**
   * Current provider price for a product (live-margin source for the admin
   * Profits page). Optional because not every provider exposes a price
   * catalogue (e.g. ebulksms). Returns null when the price is not available.
   */
  getProviderPrice?(item: ProviderPriceItem): Promise<number | null>;

  buyAirtime(order: VendorOrder): Promise<VendorResult>;
  buyData(order: VendorOrder): Promise<VendorResult>;
  buyCable(order: VendorOrder): Promise<VendorResult>;
  buyElectricity(order: VendorOrder): Promise<VendorResult>;
  buyWaec(order: VendorOrder): Promise<VendorResult>;
  /**
   * JAMB pin vending. Optional because not every provider vends JAMB pins
   * (e.g. the SMS-only ebulksms adapter) — the routing service falls back to a
   * definite `failed` result when a provider does not implement it.
   */
  buyJamb?(order: VendorOrder): Promise<VendorResult>;
  buySms(order: VendorOrder): Promise<VendorResult>;
  verifyCustomer(params: VerifyParams): Promise<CustomerVerification>;
  requery(params: RequeryParams): Promise<VendorResult>;
  getBalance(): Promise<VendorBalance>;
}