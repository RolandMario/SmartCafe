export type ServiceType =
  | 'AIRTIME'
  | 'DATA'
  | 'CABLE'
  | 'ELECTRICITY'
  | 'WAEC'
  | 'JAMB'
  | 'SMS';

export type TransactionStatus = 'pending' | 'success' | 'failed';

/** Which wallet funds / is affected by a purchase ('main' | cashback). */
export type PaymentWallet = 'main' | 'cashback';

export interface User {
  _id: string;
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'reseller' | 'admin';
  isActive: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CatalogItem {
  _id: string;
  service: ServiceType;
  provider: string;
  providerLabel: string;
  productCode: string;
  name: string;
  description?: string;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  unitPrice?: number;
  validityDays?: number;
  commission?: number;
  /** Reseller cashback percentage (0–100) — resellers earn at this higher rate. */
  resellerCommission?: number;
  active: boolean;
  sortOrder: number;
}

export interface Transaction {
  _id: string;
  service: ServiceType;
  reference: string;
  requestId: string;
  amount: number;
  commission: number;
  /** Which wallet funded the purchase ('main' default | 'cashback'). */
  paymentWallet?: PaymentWallet;
  /** Cashback the user earns when this purchase succeeds (always >= 0). */
  cashback?: number;
  /** True once the earned cashback has been credited to the cashback wallet. */
  cashbackCredited?: boolean;
  status: TransactionStatus;
  meta: Record<string, any>;
  providerMeta: Record<string, any>;
  vendorReference?: string;
  failureReason?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The customer's current cable plan returned by /cable/verify — what the cable
 * purchase screen shows (name, plan, due date, amount) so "Renew" can buy the
 * exact package the customer is already on.
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
  /** Reseller cashback percentage (0–100) — resellers earn at this higher rate. */
  resellerCommission?: number;
}

export interface CustomerVerification {
  name: string;
  address?: string;
  customerRef?: string;
  /** Customer's current cable subscription — present when the vendor reports it. */
  currentPlan?: CableCurrentPlan | null;
  /** Catalog-matched package for the current plan — what the Renew button buys. */
  renewal?: CableRenewal | null;
  extra?: Record<string, any>;
}

export interface PurchaseResult {
  status: TransactionStatus;
  transaction: Transaction;
}

/** One service's analytics bucket: how many successful purchases and total amount spent. */
export interface ServiceStatsItem {
  service: ServiceType;
  count: number;
  volume: number;
}

/** Response of GET /transactions/stats — zero-filled for every service type. */
export interface AnalyticsStats {
  /** Selected month as YYYY-MM, or 'all' when no month filter was applied. */
  month: string;
  /** Total number of successful purchases across all services. */
  total: number;
  items: ServiceStatsItem[];
}

export interface WalletInfo {
  balance: number;
  /** Cashback earned on successful purchases — spendable, never withdrawable. */
  cashbackBalance: number;
  currency: string;
}

export type FundingStatus = 'pending' | 'credited' | 'failed';
export type FundingProvider = 'paystack' | 'cashback' | 'manual';

export type DedicatedAccountStatus = 'pending' | 'active' | 'failed';

/** A payment gateway the app should currently offer for wallet funding. */
export interface ActiveGateway {
  provider: 'paystack';
  label: string;
}

/**
 * Company bank account for Cashback Funding. Users transfer wallet top-ups to
 * this account and the deposit is credited after an admin verifies the transfer
 * (returned by GET /funding/cashback-info).
 */
export interface CashbackAccountInfo {
  accountName: string;
  accountNumber: string;
  bankName: string;
  /** Cashback funding bonus % — credited to the user's cashback wallet after admin approval (0 = disabled). */
  cashbackPercentage?: number;
}

/**
 * The user's personal Paystack dedicated virtual account (DVA): a bank account
 * number they receive transfers on, which auto-credit their wallet. `pending`
 * means the bank is still provisioning the number asynchronously.
 */
export interface DedicatedAccount {
  _id: string;
  status: DedicatedAccountStatus;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  customerCode: string;
  provider: 'paystack';
  createdAt?: string;
}

export interface FundingRecord {
  _id: string;
  amount: number;
  reference: string;
  paymentReference?: string;
  transactionReference?: string;
  checkoutUrl?: string;
  status: FundingStatus;
  provider: FundingProvider;
  method: string;
  adminNote?: string;
  /** User-keyed bank-transfer reference for `cashback` (company-account) funding — lets the admin match the transfer. */
  transferReference?: string;
  /** Cashback wallet bonus (₦) credited alongside the top-up once approved. */
  cashbackAmount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface FundingInitResult {
  funding: FundingRecord;
  provider: FundingProvider;
  checkoutUrl: string | null;
  paymentReference: string;
}

/**
 * A row in the mobile History feed — either a purchase transaction or a wallet
 * top-up (funding) record. Funding records carry a `provider` and no `service`,
 * which is how the client tells the two apart.
 */
export type HistoryEntry = Transaction | FundingRecord;

export type ServiceKey = 'airtime' | 'data' | 'cable' | 'electricity' | 'waec' | 'jamb' | 'sms';
