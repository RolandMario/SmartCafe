/**
 * Shared payment-gateway abstraction.
 *
 * Every payment provider (Monnify, Paystack, …) implements `PaymentGateway`
 * so the funding service can route deposits, verification and webhooks by
 * gateway name instead of depending on one concrete adapter. This mirrors
 * the `VendorProvider` pattern used in `src/vendors/`.
 */

/** Payment gateway identifiers. */
export type PaymentProvider = 'monnify' | 'paystack';

/** Normalised verification outcome used by the rest of the app. */
export type PaymentOutcome = 'success' | 'pending' | 'failed';

/** Normalised webhook event class used by the funding service. */
export type WebhookEventClass = 'success' | 'failed' | 'ignored';

export interface PaymentInitParams {
  amount: number;
  customerName: string;
  customerEmail: string;
  /** Our unique order reference. Must be unique per transaction. */
  paymentReference: string;
  paymentDescription: string;
  /** Where the gateway redirects the customer after payment. */
  redirectUrl: string;
  /** Optional channel restriction (gateway-specific values). */
  paymentMethods?: string[];
}

export interface PaymentInitResult {
  /** URL the client opens to complete the payment. */
  checkoutUrl: string;
  /** Gateway-issued transaction reference. */
  transactionReference: string;
  paymentReference: string;
  merchantName: string;
  enabledPaymentMethod: string[];
}

export interface PaymentVerifyResult {
  outcome: PaymentOutcome;
  /** Gateway-specific payment status (PAID, success, …). */
  paymentStatus: string;
  /** Actual amount received by the gateway (naira, decimal). */
  amountPaid: number;
  totalPayable: number;
  paidOn?: string;
  paymentReference: string;
  transactionReference?: string;
  paymentMethod?: string;
  /** The full gateway verification payload for audit / reconciliation. */
  raw: Record<string, any>;
}

export interface PaymentGateway {
  readonly name: PaymentProvider;
  /** Display label for the admin/UI (e.g. 'Monnify Checkout'). */
  readonly label: string;

  /** Whether credentials are present for this gateway. */
  isConfigured(): boolean;

  /** Redirect URL the gateway sends the customer back to after payment. */
  buildRedirectUrl(requestBaseUrl?: string): string;

  /** Create a hosted checkout session and return the checkout URL. */
  initializeTransaction(params: PaymentInitParams): Promise<PaymentInitResult>;

  /** Server-to-server verification by our own payment reference. */
  verifyPaymentByReference(paymentReference: string): Promise<PaymentVerifyResult>;

  /** Validate the gateway's webhook signature over the raw body. */
  verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean;

  /** Sandbox webhooks may carry no signature; require explicit opt-in. */
  allowInsecureWebhooks(): boolean;

  /** Optional source IP allow-list for webhooks (empty = no restriction). */
  allowedIp(): string;

  /** Extract our payment reference from a gateway webhook payload. */
  extractPaymentReference(payload: Record<string, any>): string | undefined;

  /** Map a gateway webhook payload to a normalised event class. */
  classifyWebhookEvent(payload: Record<string, any>): {
    eventClass: WebhookEventClass;
    providerEventType: string;
  };
}