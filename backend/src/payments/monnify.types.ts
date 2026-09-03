/**
 * Monnify payment gateway — shared types.
 *
 * API docs: https://developers.monnify.com
 *  - Checkout API:     POST /api/v1/merchant/transactions/init-transaction
 *  - Verify API:       GET  /api/v1/merchant/transactions/query?paymentReference=...
 *  - Auth:             POST /api/v1/auth/login  (Basic: apiKey:secretKey)
 */

/** Payment statuses reported by the Monnify verify endpoint. */
export type MonnifyPaymentStatus =
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'PENDING'
  | 'FAILED'
  | 'REVERSED'
  | 'EXPIRED'
  | 'OVERPAID';

/** Normalised verification result used by the rest of the app. */
export type MonnifyOutcome = 'success' | 'pending' | 'failed';

export interface MonnifyInitParams {
  amount: number;
  customerName: string;
  customerEmail: string;
  /** Our unique order reference. Must be unique per transaction. */
  paymentReference: string;
  paymentDescription: string;
  /** Where Monnify redirects the customer after payment. */
  redirectUrl: string;
  /** Optional restriction, e.g. ['CARD', 'ACCOUNT_TRANSFER', 'USSD']. */
  paymentMethods?: string[];
}

export interface MonnifyInitResult {
  checkoutUrl: string;
  transactionReference: string;
  paymentReference: string;
  merchantName: string;
  enabledPaymentMethod: string[];
}

export interface MonnifyVerifyResult {
  outcome: MonnifyOutcome;
  paymentStatus: MonnifyPaymentStatus;
  /** Actual amount received by Monnify. */
  amountPaid: number;
  totalPayable: number;
  paidOn?: string;
  paymentReference: string;
  transactionReference?: string;
  paymentMethod?: string;
  /** The full Monnify `responseBody` for audit / reconciliation. */
  raw: Record<string, any>;
}

export interface MonnifyWebhookPayload {
  eventType: string;
  eventData: MonnifyWebhookEventData;
  [key: string]: any;
}

export interface MonnifyWebhookEventData {
  transactionReference?: string;
  paymentReference?: string;
  amountPaid?: number;
  totalPayable?: number;
  settlementAmount?: number;
  paidOn?: string;
  paymentStatus?: string;
  paymentDescription?: string;
  paymentMethod?: string;
  currencyCode?: string;
  customer?: Record<string, any>;
  product?: Record<string, any>;
}