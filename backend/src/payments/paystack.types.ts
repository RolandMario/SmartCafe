/**
 * Paystack payment gateway — shared types.
 *
 * API docs: https://paystack.com/docs/api/transaction/
 *  - Initialize:  POST   /transaction/initialize
 *  - Verify:      GET    /transaction/verify/:reference
 *  - Auth:        Bearer secret key (sk_test_... / sk_live_...)
 *
 * Amounts are always in kobo (minor units) on the wire; the service converts
 * to/from naira at the adapter boundary.
 */

export interface PaystackInitData {
  authorization_url: string;
  access_code?: string;
  reference: string;
  amount?: number;
  currency?: string;
}

export interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: PaystackInitData;
}

/** `status` values seen from the verify endpoint: success | failed | abandoned. */
export interface PaystackVerifyData {
  id?: number;
  reference: string;
  status: string;
  /** Amount in kobo. */
  amount?: number;
  paid_at?: string;
  channel?: string;
  currency?: string;
  [key: string]: any;
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: PaystackVerifyData | null;
}

/** Structure of a Paystack webhook notification: `{ event, data }`. */
export interface PaystackWebhookPayload {
  event: string;
  data: {
    reference?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Dedicated Virtual Accounts (DVA)
// API docs: https://paystack.com/docs/api/dedicated-virtual-account/
// ---------------------------------------------------------------------------

export interface PaystackCustomerData {
  id: number;
  customer_code: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, any>;
  risk_action?: string;
  [key: string]: any;
}

export interface PaystackCustomerResponse {
  status: boolean;
  message: string;
  data: PaystackCustomerData;
}

/** Shape a DVA create/fetch returns (sync vs async assignment differs). */
export interface PaystackDedicatedAccountData {
  id?: number;
  account_name?: string;
  account_number?: string;
  assigned?: boolean;
  active?: boolean;
  currency?: string;
  bank?: { name: string; id: number; slug?: string };
  customer?: {
    id?: number;
    customer_code?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  };
  /** Present (with status 'provisioning') when the bank assigns asynchronously. */
  assignment?: {
    status?: 'provisioning' | 'assigned' | string;
    account_number?: string;
    integration?: number;
    assigned_at?: string;
    expired?: boolean;
  };
  provider?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface PaystackCreateDedicatedAccountResponse {
  status: boolean;
  message: string;
  data: PaystackDedicatedAccountData | null;
}

export interface PaystackDedicatedAccountListResponse {
  status: boolean;
  message: string;
  data: PaystackDedicatedAccountData[];
}

export interface PaystackRequeryDedicatedAccountData {
  assigned: boolean;
  account_number?: string;
  account_name?: string;
  bank?: { name: string; id: number; slug?: string };
  [key: string]: any;
}

export interface PaystackRequeryDedicatedAccountResponse {
  status: boolean;
  message: string;
  data: PaystackRequeryDedicatedAccountData | null;
}
