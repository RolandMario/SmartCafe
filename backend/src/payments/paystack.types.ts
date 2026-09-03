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