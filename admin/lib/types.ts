export type ServiceType = 'AIRTIME' | 'DATA' | 'CABLE' | 'ELECTRICITY' | 'WAEC' | 'JAMB' | 'SMS';
export type TransactionStatus = 'pending' | 'success' | 'failed';

export interface User {
  _id: string;
  name: string;
  email: string;
  phone: string;
  role: 'user' | 'reseller' | 'admin';
  isActive: boolean;
  createdAt?: string;
}

export interface UserWalletInfo {
  balance: number;
  cashbackBalance: number;
  currency: string;
}

/** One service bucket in a user's purchase stats. */
export interface UserServiceStat {
  service: ServiceType;
  count: number;
  /** Total naira spent on successful purchases of this service. */
  volume: number;
}

/** Full admin view of a single user (GET /admin/users/:id). */
export interface UserDetail extends User {
  wallet: UserWalletInfo;
  stats: {
    total: number;
    items: UserServiceStat[];
  };
}

export interface Wallet {
  _id: string;
  user: string;
  balance: number;
  currency: string;
}

export interface CatalogItem {
  _id: string;
  service: ServiceType;
  provider: string;
  providerLabel: string;
  productCode: string;
  name: string;
  description?: string;
  /** Fulfilling vendor for DATA plans — dictates which vendor account is debited. */
  vendor?: "pairgate" | "vtpass" | "peyflex" | "static";
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  unitPrice?: number;
  providerUnitCost?: number;
  validityDays?: number;
  commission?: number;
  /** Reseller cashback percentage (0–100) — resellers earn at this higher rate. */
  resellerCommission?: number;
  active: boolean;
  sortOrder: number;
}

/** Paginated admin catalog listing (server-side, 15 per page). */
export interface CatalogListResponse {
  items: CatalogItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface Transaction {
  _id: string;
  service: ServiceType;
  reference: string;
  amount: number;
  commission: number;
  /** The amount the vendor provider actually charged (profit = amount − providerCost). */
  providerCost?: number;
  status: TransactionStatus;
  meta: Record<string, any>;
  providerMeta: Record<string, any>;
  user?: { _id: string; name: string; email: string; phone: string };
  failureReason?: string;
  createdAt: string;
}

export interface Funding {
  _id: string;
  user?: { _id: string; name: string; email: string; phone: string };
  amount: number;
  reference: string;
  status: 'pending' | 'credited' | 'failed';
  provider?: 'paystack' | 'cashback' | 'manual';
  method?: string;
  paymentReference?: string;
  /** Transfer reference the user keyed in for cashback (company-account) funding — used to match the incoming transfer. */
  transferReference?: string;
  adminNote?: string;
  /** Cashback wallet bonus credited (plus the top-up) for approved cashback funding. */
  cashbackAmount?: number;
  createdAt: string;
}

/**
 * Persistent Cashback Funding bonus rate (admin-editable). A percentage of the
 * funded amount is credited to the user's cashback wallet when a Cashback
 * Funding request is approved. 0 disables the bonus.
 */
export interface CashbackFundingConfig {
  percentage: number;
  updatedBy?: string | null;
  updatedAt?: string;
}

export interface Dashboard {
  totalUsers: number;
  totals: { volume: number; commission: number; count: number };
  byService: { _id: ServiceType; count: number; volume: number }[];
  counts: { pending: number; failed: number; success: number };
  recent: Transaction[];
  vendorProvider: string;
  vendorConfigs: ServiceVendorConfig[];
}

export type VendorProviderName = "mock" | "vtpass" | "ebulksms" | "pairgate" | "peyflex";

export interface VendorProviderInfo {
  name: VendorProviderName;
  supportedServices: ServiceType[];
}

export interface ServiceVendorConfig {
  service: ServiceType;
  provider: VendorProviderName;
  /** Whether the currently selected provider can actually fulfil this service. */
  supported: boolean;
}

export interface VendorOverview {
  globalDefault: VendorProviderName;
  providers: VendorProviderInfo[];
  configs: ServiceVendorConfig[];
  /** Active DATA catalog broken down by plan source (pairgate vs vtpass). */
  dataCatalog: DataCatalogInfo;
  /** Status of the current/last DATA catalog re-seed. */
  dataSync: DataSyncStatus;
}

export interface VendorBalance {
  provider: VendorProviderName;
  balance: number;
  currency: string;
}

/** Active DATA catalog split by vendor source (Pairgate vs Peyflex vs VTPass/static). */
export interface DataCatalogInfo {
  total: number;
  pairgate: number;
  vtpass: number;
  peyflex: number;
  source: "pairgate" | "vtpass" | "peyflex" | "mixed" | "empty";
}

/** Status of the most recent DATA catalog re-seed (switch / manual refresh). */
export interface DataSyncStatus {
  state: "idle" | "syncing" | "done" | "error";
  source?: "all" | "pairgate" | "vtpass";
  startedAt?: string;
  finishedAt?: string;
  synced?: number;
  removed?: number;
  message?: string;
}

export type PaymentProvider = "paystack";

export interface PaymentGatewayStatus {
  provider: PaymentProvider;
  label: string;
  /** Credentials are present in the backend env vars. */
  configured: boolean;
  /** Admin toggle (missing rows default to enabled). */
  enabled: boolean;
  /** A user can actually fund their wallet through it now. */
  active: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export type ProfitRange = "today" | "7d" | "30d" | "all";

export type DataPlanRange = "7d" | "30d" | "90d" | "all";

/** Totals for a single data plan across the selected period. */
export interface DataPlanPlanTotal {
  key: string;
  label: string;
  count: number;
  revenue: number;
}

/** One time bucket (day or month) with per-plan purchases. */
export interface DataPlanSeriesPoint {
  bucket: string;
  count: number;
  revenue: number;
  plans: Record<string, { count: number; revenue: number }>;
}

/** Response of GET /admin/data-plan-sales?range=… */
export interface DataPlanSales {
  range: DataPlanRange;
  since: string | null;
  totals: { count: number; revenue: number };
  series: DataPlanSeriesPoint[];
  plans: DataPlanPlanTotal[];
}

export interface CategoryProfit {
  category: string;
  count: number;
  sales: number;
  providerCost: number;
  /** Platform commission profit for this category (per-service schedule). */
  commission: number;
  profit: number;
  margin: number;
  /** Successful transactions in this category with a captured provider cost. */
  measured: number;
}

export interface ProfitTotals {
  sales: number;
  providerCost: number;
  commission: number;
  profit: number;
  margin: number;
  measuredCount: number;
  unmeasuredCount: number;
}

export interface MarginItem {
  productId: string;
  name: string;
  productCode: string;
  salesPrice?: number | null;
  providerPrice?: number | null;
  margin?: number | null;
}

export interface MarginCategory {
  category: string;
  covered: number;
  total: number;
  items: MarginItem[];
  salesTotal: number;
  providerTotal: number;
  profitTotal: number;
}

export interface ProfitReport {
  range: ProfitRange;
  since: string | null;
  totals: ProfitTotals;
  byCategory: CategoryProfit[];
  margins: MarginCategory[];
  recent: Transaction[];
}