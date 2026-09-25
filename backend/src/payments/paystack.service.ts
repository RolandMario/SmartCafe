import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
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
  PaystackCreateDedicatedAccountResponse,
  PaystackCustomerResponse,
  PaystackDedicatedAccountData,
  PaystackDedicatedAccountListResponse,
  PaystackInitResponse,
  PaystackRequeryDedicatedAccountResponse,
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

  // ---------------------------------------------------------------------------
  // Dedicated Virtual Accounts (DVA)
  // Docs: https://paystack.com/docs/api/dedicated-virtual-account/
  //
  // Paystack keys DVAs by CUSTOMER (not by transaction), and DVA events arrive
  // on the same webhook URL as charge events, so these helpers sit alongside
  // the PaymentGateway contract but are kept out of it.
  // ---------------------------------------------------------------------------

  /**
   * Authenticated request helper. Non-2xx responses and network failures
   * surface as `BadGatewayException` with the provider's message so callers can
   * fall back gracefully (e.g. a 404 customer lookup → create the customer).
   */
  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const res = await this.client.request<T>({
        ...config,
        headers: {
          Authorization: `Bearer ${this.secretKey()}`,
          ...(config.headers ?? {}),
        },
      });
      return res.data;
    } catch (e) {
      let providerMessage = e instanceof Error ? e.message : String(e);
      if (axios.isAxiosError(e) && e.response) {
        const msg = (e.response.data as any)?.message;
        if (msg) providerMessage = String(msg);
      }
      throw new BadGatewayException(`Paystack request failed: ${providerMessage}`);
    }
  }

  /**
   * Resolve (or create) the Paystack customer for this app user. Paystack keys
   * customers by email, so we look the customer up first — a customer may
   * already exist from a previous checkout or DVA creation and creating it a
   * second time would 400.
   */
  async getOrCreateCustomer(params: {
    email: string;
    name: string;
    phone?: string;
  }): Promise<{ customerCode: string }> {
    const { email, name, phone } = params;
    const [first, ...rest] = (name ?? '').trim().split(/\s+/);

    try {
      const found = await this.request<PaystackCustomerResponse>({
        method: 'get',
        url: `/customer/${encodeURIComponent(email)}`,
      });
      if (found?.data?.customer_code) {
        return { customerCode: found.data.customer_code };
      }
    } catch {
      // 404 (unknown customer) or transient issue → fall through to create.
    }

    const created = await this.request<PaystackCustomerResponse>({
      method: 'post',
      url: '/customer',
      data: {
        email,
        first_name: first || 'Customer',
        last_name: rest.join(' ') || 'Guest',
        ...(phone ? { phone } : {}),
      },
    });
    if (!created?.status || !created?.data?.customer_code) {
      throw new BadGatewayException(
        `Paystack customer creation failed: ${created?.message ?? 'unknown error'}`,
      );
    }
    return { customerCode: created.data.customer_code };
  }
/**
   * Create a dedicated virtual account for an existing customer.
   *
   * Assignment is synchronous for some banks (`assigned: true` with an
   * `account_number` in the response — test-bank, titan-paystack) and
   * asynchronous for others (wema/providus, where the response has
   * `assigned: false` and `assignment.status === 'provisioning'`). For async
   * banks the account is finished via the `dedicatedaccount.assign.success`
   * webhook and/or a `POST /dedicated_account/requery`.
   */
  async createDedicatedAccount(params: {
    customerCode: string;
    preferredBank?: string;
  }): Promise<PaystackDedicatedAccountData> {
    const preferredBank =
      params.preferredBank ??
      this.config.get<string>('PAYSTACK_DVA_PREFERRED_BANK', 'wema-bank');
    const { data } = await this.request<PaystackCreateDedicatedAccountResponse>({
      method: 'post',
      url: '/dedicated_account',
      data: {
        customer: params.customerCode,
        preferred_bank: preferredBank,
      },
    });
    if (!data?.status || !data?.data) {
      throw new BadGatewayException(
        `Paystack dedicated account creation failed: ${data?.message ?? 'unknown error'}`,
      );
    }
    return data.data;
  }

  /** List dedicated accounts belonging to a customer (normally 0 or 1). */
  async listCustomerDedicatedAccounts(
    customerCode: string,
  ): Promise<PaystackDedicatedAccountData[]> {
    const res = await this.request<PaystackDedicatedAccountListResponse>({
      method: 'get',
      url: '/dedicated_account',
      params: { customer: customerCode },
    });
    if (!res?.status || !Array.isArray(res?.data)) {
      throw new BadGatewayException(
        `Paystack dedicated account lookup failed: ${res?.message ?? 'unknown error'}`,
      );
    }
    return res.data;
  }

  /**
   * Ask Paystack whether an asynchronously-provisioned DVA is ready. Safe to
   * call repeatedly while `assignment.status === 'provisioning'`; returns
   * `assigned: true` plus the account number once the bank has finished.
   */
  async requeryDedicatedAccount(params: {
    customerCode?: string;
    accountNumber?: string;
  }): Promise<Record<string, any>> {
    const { data } = await this.request<PaystackRequeryDedicatedAccountResponse>({
      method: 'post',
      url: '/dedicated_account/requery',
      data: {
        ...(params.customerCode ? { customer: params.customerCode } : {}),
        ...(params.accountNumber ? { account_number: params.accountNumber } : {}),
      },
    });
    if (!data?.status || !data?.data) {
      throw new BadGatewayException(
        `Paystack dedicated account requery failed: ${data?.message ?? 'unknown error'}`,
      );
    }
    return data.data;
  }
}