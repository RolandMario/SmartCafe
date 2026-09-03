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
  MonnifyInitParams,
  MonnifyInitResult,
  MonnifyOutcome,
  MonnifyVerifyResult,
} from './monnify.types';
import {
  PaymentGateway,
  PaymentProvider,
  WebhookEventClass,
} from './payment-gateway.interface';

/**
 * Monnify payment gateway adapter.
 *
 * Flow (hosted checkout):
 *  1. `initializeTransaction()` creates a checkout session server-side and
 *     returns a Monnify-hosted `checkoutUrl`.
 *  2. The client is redirected to `checkoutUrl`; Monnify handles the entire
 *     payment UI and redirects back to `redirectUrl`.
 *  3. The server confirms the payment via `verifyPaymentByReference()` and/or
 *     a signed webhook before crediting the wallet — never trust the redirect.
 *
 * Configure with:
 *   MONNIFY_BASE_URL      (sandbox: https://sandbox.monnify.com)
 *   MONNIFY_API_KEY       (Secret API key)
 *   MONNIFY_SECRET_KEY    (Secret key — also used for webhook HMAC)
 *   MONNIFY_CONTRACT_CODE
 */
@Injectable()
export class MonnifyService implements PaymentGateway {
  readonly name: PaymentProvider = 'monnify';
  readonly label = 'Monnify Checkout';

  private readonly logger = new Logger(MonnifyService.name);
  private readonly client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private config: ConfigService) {
    const baseUrl = this.config.get<string>(
      'MONNIFY_BASE_URL',
      'https://sandbox.monnify.com',
    );
    this.client = axios.create({ baseURL: baseUrl, timeout: 30000 });
  }

  isConfigured(): boolean {
    return (
      !!this.config.get<string>('MONNIFY_API_KEY', '') &&
      !!this.config.get<string>('MONNIFY_SECRET_KEY', '') &&
      !!this.config.get<string>('MONNIFY_CONTRACT_CODE', '')
    );
  }

  /** Redirect URL Monnify sends the customer back to after payment. */
  buildRedirectUrl(requestBaseUrl?: string): string {
    const configured = this.config.get<string>('MONNIFY_REDIRECT_URL', '');
    if (configured) return configured;
    if (requestBaseUrl) return `${requestBaseUrl.replace(/\/+$/, '')}/api/funding/webhook/monnify/callback`;
    throw new UnauthorizedException(
      'MONNIFY_REDIRECT_URL is not configured and no request base URL was supplied',
    );
  }

  /**
   * Bearer token for authenticated API calls.
   * Monnify tokens are valid for ~1 hour, so we cache with a safety margin.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.tokenExpiresAt > Date.now()) return this.token;

    const apiKey = this.config.get<string>('MONNIFY_API_KEY', '');
    const secretKey = this.config.get<string>('MONNIFY_SECRET_KEY', '');
    const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

    const { data } = await this.client.post(
      '/api/v1/auth/login',
      {},
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } },
    );
    const body = data?.responseBody;
    if (!data?.requestSuccessful || !body?.accessToken) {
      throw new BadGatewayException(
        `Monnify authentication failed: ${data?.responseMessage ?? 'no token returned'}`,
      );
    }
    const expiresInSeconds = Number(body.expiresIn ?? 3600);
    // Some API revisions report milliseconds; normalise to seconds.
    const ttlMs = expiresInSeconds > 1e6 ? expiresInSeconds : expiresInSeconds * 1000;
    this.token = body.accessToken;
    this.tokenExpiresAt = Date.now() + ttlMs - 5 * 60 * 1000;
    this.logger.debug('Obtained new Monnify bearer token');
    return this.token as string;
  }

  /** Create a checkout session and return the hosted Monnify checkout URL. */
  async initializeTransaction(params: MonnifyInitParams): Promise<MonnifyInitResult> {
    const contractCode = this.config.get<string>('MONNIFY_CONTRACT_CODE', '');
    const token = await this.accessToken();

    const { data } = await this.client.post(
      '/api/v1/merchant/transactions/init-transaction',
      {
        amount: params.amount,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        paymentReference: params.paymentReference,
        paymentDescription: params.paymentDescription,
        currencyCode: 'NGN',
        contractCode,
        redirectUrl: params.redirectUrl,
        ...(params.paymentMethods?.length ? { paymentMethods: params.paymentMethods } : {}),
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const body = data?.responseBody;
    if (!data?.requestSuccessful || !body?.checkoutUrl) {
      throw new BadGatewayException(
        `Monnify checkout initialisation failed: ${data?.responseMessage ?? data?.responseBody?.message ?? 'unknown error'}`,
      );
    }

    // Safety check (Monnify docs): confirm the returned details match what we sent.
    if (body.paymentReference && params.paymentReference && body.paymentReference !== params.paymentReference) {
      throw new BadGatewayException('Monnify returned a different payment reference');
    }
    if (Number(body.amount ?? 0) && Number(body.amount) !== params.amount) {
      throw new BadGatewayException('Monnify returned a different amount');
    }

    return {
      checkoutUrl: body.checkoutUrl,
      transactionReference: body.transactionReference,
      paymentReference: body.paymentReference ?? params.paymentReference,
      merchantName: body.merchantName,
      enabledPaymentMethod: body.enabledPaymentMethod ?? [],
    };
  }

  /**
   * Server-to-server verification by our own payment reference.
   * Authoritative status — never rely on the client-side redirect.
   */
  async verifyPaymentByReference(paymentReference: string): Promise<MonnifyVerifyResult> {
    const token = await this.accessToken();
    const { data } = await this.client.get('/api/v1/merchant/transactions/query', {
      params: { paymentReference },
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = data?.responseBody;
    if (!data?.requestSuccessful || !body) {
      throw new BadGatewayException(
        `Monnify verification failed: ${data?.responseMessage ?? 'unknown error'}`,
      );
    }

    const paymentStatus = String(body?.paymentStatus ?? 'PENDING').toUpperCase() as MonnifyVerifyResult['paymentStatus'];
    let outcome: MonnifyOutcome = 'pending';
    if (paymentStatus === 'PAID' || paymentStatus === 'OVERPAID') {
      outcome = 'success';
    } else if (
      paymentStatus === 'FAILED' ||
      paymentStatus === 'REVERSED' ||
      paymentStatus === 'EXPIRED' ||
      paymentStatus === 'PARTIALLY_PAID'
    ) {
      outcome = 'failed';
    }

    return {
      outcome,
      paymentStatus,
      amountPaid: Number(body?.amountPaid ?? 0),
      totalPayable: Number(body?.totalPayable ?? 0),
      paidOn: body?.paidOn,
      paymentReference: body?.paymentReference ?? paymentReference,
      transactionReference: body?.transactionReference,
      paymentMethod: body?.paymentMethod,
      raw: body,
    };
  }

  /**
   * Validate the Monnify webhook signature.
   * HMAC-SHA512 of the raw request body keyed with our client secret.
   * Note: the signature header is only sent on production webhooks.
   */
  verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean {
    const clientSecret = this.config.get<string>('MONNIFY_SECRET_KEY', '');
    if (!clientSecret) return false;
    if (!signature) return false;
    const expected = createHmac('sha512', clientSecret).update(rawBody).digest('hex');
    return signature === expected;
  }

  /** Sandbox webhooks carry no signature; require explicit opt-in to trust them. */
  allowInsecureWebhooks(): boolean {
    return this.config.get<boolean>('MONNIFY_WEBHOOK_INSECURE', false) === true;
  }

  /** Optional source IP allow-list for webhooks (empty = no restriction). */
  allowedIp(): string {
    return this.config.get<string>('MONNIFY_ALLOWED_IP', '') || '';
  }

  /** Our reference lives in `eventData.paymentReference` of the webhook payload. */
  extractPaymentReference(payload: Record<string, any>): string | undefined {
    return payload?.eventData?.paymentReference as string | undefined;
  }

  classifyWebhookEvent(payload: Record<string, any>): {
    eventClass: WebhookEventClass;
    providerEventType: string;
  } {
    const eventType = String(payload?.eventType ?? '');
    let eventClass: WebhookEventClass = 'ignored';
    if (eventType === 'SUCCESSFUL_TRANSACTION') {
      eventClass = 'success';
    } else if (eventType === 'FAILED_TRANSACTION' || eventType === 'REJECTED_PAYMENT') {
      eventClass = 'failed';
    }
    return { eventClass, providerEventType: eventType };
  }
}