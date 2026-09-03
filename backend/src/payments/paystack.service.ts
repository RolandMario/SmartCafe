import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import {
  PaymentGateway,
  PaymentInitParams,
  PaymentInitResult,
  PaymentOutcome,
  PaymentProvider,
  PaymentVerifyResult,
  WebhookEventClass,
} from './payment-gateway.interface';
import {
  PaystackInitResponse,
  PaystackVerifyResponse,
} from './paystack.types';

/**
 * Paystack payment gateway adapter.
 *
 * Flow (hosted checkout):
 *  1. `initializeTransaction()` calls POST /transaction/initialize and returns
 *     the Paystack-hosted `authorization_url`.
 *  2. The client is redirected there; Paystack handles the payment UI and
 *     redirects back to `callback_url`.
 *  3. The server confirms the payment via `verifyPaymentByReference()` and/or
 *     an HMAC-signed webhook before crediting the wallet — never trust the
 *     redirect.
 *
 * Configure with:
 *   PAYSTACK_SECRET_KEY     (sk_test_... / sk_live_...)
 *   PAYSTACK_BASE_URL       (default: https://api.paystack.co)
 *   PAYSTACK_REDIRECT_URL   (optional; otherwise derived from the request)
 */
@Injectable()
export class PaystackService implements PaymentGateway {
  readonly name: PaymentProvider = 'paystack';
  readonly label = 'Paystack';

  private readonly logger = new Logger(PaystackService.name);
  private readonly client: AxiosInstance;

  constructor(private config: ConfigService) {
    const baseUrl = this.config.get<string>(
      'PAYSTACK_BASE_URL',
      'https://api.paystack.co',
    );
    this.client = axios.create({ baseURL: baseUrl, timeout: 30000 });
  }

  isConfigured(): boolean {
    return !!this.config.get<string>('PAYSTACK_SECRET_KEY', '');
  }

  private secretKey(): string {
    return this.config.get<string>('PAYSTACK_SECRET_KEY', '');
  }

  /** Redirect URL Paystack sends the customer back to after payment. */
  buildRedirectUrl(requestBaseUrl?: string): string {
    const configured = this.config.get<string>('PAYSTACK_REDIRECT_URL', '');
    if (configured) return configured;
    if (requestBaseUrl) {
      return `${requestBaseUrl.replace(/\/+$/, '')}/api/funding/webhook/paystack/callback`;
    }
    throw new UnauthorizedException(
      'PAYSTACK_REDIRECT_URL is not configured and no request base URL was supplied',
    );
  }

  /** Create a checkout session and return the hosted Paystack checkout URL. */
  async initializeTransaction(params: PaymentInitParams): Promise<PaymentInitResult> {
    const { data } = await this.client.post<PaystackInitResponse>(
      '/transaction/initialize',
      {
        email: params.customerEmail,
        // Paystack deals in minor units (kobo).
        amount: Math.round(params.amount * 100),
        currency: 'NGN',
        reference: params.paymentReference,
        callback_url: params.redirectUrl,
        ...(params.paymentMethods?.length ? { channels: params.paymentMethods } : {}),
      },
      { headers: { Authorization: `Bearer ${this.secretKey()}` } },
    );

    if (!data?.status || !data?.data?.authorization_url) {
      throw new BadGatewayException(
        `Paystack transaction initialisation failed: ${data?.message ?? 'unknown error'}`,
      );
    }

    // Safety check: confirm the returned reference matches what we sent.
    if (data.data.reference && params.paymentReference && data.data.reference !== params.paymentReference) {
      throw new BadGatewayException('Paystack returned a different reference');
    }

    return {
      checkoutUrl: data.data.authorization_url,
      transactionReference: data.data.reference,
      paymentReference: data.data.reference ?? params.paymentReference,
      merchantName: 'Paystack',
      enabledPaymentMethod: params.paymentMethods ?? [],
    };
  }

  /**
   * Server-to-server verification by our own payment reference.
   * Authoritative status — never rely on the client-side redirect.
   */
  async verifyPaymentByReference(paymentReference: string): Promise<PaymentVerifyResult> {
    const { data } = await this.client.get<PaystackVerifyResponse>(
      `/transaction/verify/${encodeURIComponent(paymentReference)}`,
      { headers: { Authorization: `Bearer ${this.secretKey()}` } },
    );

    if (!data?.status || !data?.data) {
      throw new BadGatewayException(
        `Paystack verification failed: ${data?.message ?? 'unknown error'}`,
      );
    }

    const txn = data.data;
    const paymentStatus = String(txn.status ?? 'pending').toUpperCase();
    let outcome: PaymentOutcome = 'pending';
    if (paymentStatus === 'SUCCESS') {
      outcome = 'success';
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'ABANDONED') {
      outcome = 'failed';
    }

    const amountPaid = Number(txn.amount ?? 0) / 100; // kobo → naira

    return {
      outcome,
      paymentStatus,
      amountPaid,
      totalPayable: amountPaid,
      paidOn: txn.paid_at,
      paymentReference: txn.reference ?? paymentReference,
      transactionReference: txn.reference,
      paymentMethod: txn.channel,
      raw: txn,
    };
  }

  /**
   * Validate the Paystack webhook signature.
   * HMAC-SHA512 of the raw request body keyed with our secret key.
   */
  verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean {
    const secretKey = this.secretKey();
    if (!secretKey) return false;
    if (!signature) return false;
    const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
    return signature === expected;
  }

  /** Sandbox/behind-a-tunnel webhooks may lack a header; opt-in only. */
  allowInsecureWebhooks(): boolean {
    return this.config.get<boolean>('PAYSTACK_WEBHOOK_INSECURE', false) === true;
  }

  /** Optional source IP allow-list for webhooks (empty = no restriction). */
  allowedIp(): string {
    return this.config.get<string>('PAYSTACK_ALLOWED_IP', '') || '';
  }

  /** Our reference lives in `data.reference` of the webhook payload. */
  extractPaymentReference(payload: Record<string, any>): string | undefined {
    return payload?.data?.reference as string | undefined;
  }

  classifyWebhookEvent(payload: Record<string, any>): {
    eventClass: WebhookEventClass;
    providerEventType: string;
  } {
    const event = String(payload?.event ?? '');
    let eventClass: WebhookEventClass = 'ignored';
    if (event === 'charge.success') {
      eventClass = 'success';
    } else if (event === 'charge.failure' || event === 'charge.abandoned') {
      eventClass = 'failed';
    }
    return { eventClass, providerEventType: event };
  }
}