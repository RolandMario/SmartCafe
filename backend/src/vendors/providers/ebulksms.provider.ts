import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ServiceType } from '../../common/enums';
import { toInternationalFormat } from '../../common/utils/phone';
import {
  CustomerVerification,
  RequeryParams,
  VerifyParams,
  VendorOrder,
  VendorProvider,
  VendorResult,
} from '../vendor-provider.interface';

/**
 * eBulkSMS provider adapter for bulk SMS
 * (https://www.ebulksms.com/pages/api-docs).
 *
 * API reference (JSON API):
 *  - Send endpoint : `POST https://api.ebulksms.com/sendsms.json`
 *    Content-Type MUST be `application/json`, body nested under `SMS`.
 *  - Balance       : `GET https://api.ebulksms.com/balance/{username}/{apikey}`
 *  - Auth is per-request (username + apikey in the body) — NOT header based.
 *  - `sender`        alphanumeric max 11 chars (numeric max 14).
 *  - `messagetext`   max 4 pages of 160 chars = 612 chars total.
 *  - `gsm`/`msidn`   recipient numbers in full international format (`23480…`).
 *  - Replies are status strings, e.g. `SUCCESS`, `AUTH_FAILURE`,
 *    `INVALID_RECIPIENT`, `INSUFFICIENT_CREDIT`, ... (JSON: `response.status`).
 *
 * Switch into production by setting `VENDOR_PROVIDER=ebulksms` and supplying
 * `EBULK_USERNAME` / `EBULK_API_KEY`. This adapter only implements SMS — the
 * remaining `VendorProvider` methods return a definite `failed` result because
 * ebulksms does not vend airtime/data/cable/electricity/WAEC on this platform.
 */
@Injectable()
export class EbulksmsProvider implements VendorProvider {
  readonly name = 'ebulksms';
  /** ebulksms only vends bulk SMS on this platform. */
  readonly supportedServices: ServiceType[] = [ServiceType.SMS];
  private readonly logger = new Logger(EbulksmsProvider.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly apikey: string;

  /**
   * ebulksms statuses that mean the message was DEFINITELY not accepted.
   * These are permanent errors (the docs explicitly say recipient/message/
   * sender errors must not be resent), so the platform refunds the wallet
   * debit via the existing `failed` settlement path.
   */
  private static readonly FAILURE_STATUSES = new Set([
    'INVALID_JSON',
    'MISSING_USERNAME',
    'MISSING_APIKEY',
    'AUTH_FAILURE',
    'MISSING_SENDER',
    'MISSING_MESSAGE',
    'MISSING_RECIPIENT',
    'INVALID_RECIPIENT',
    'INVALID_MESSAGE',
    'INVALID_SENDER',
    'INSUFFICIENT_CREDIT',
    'UNKNOWN_CONTENTTYPE',
    'UNKNOWN_ERROR',
  ]);

  constructor(private config: ConfigService) {
    this.baseUrl = String(
      this.config.get<string>('EBULK_BASE_URL') ?? 'https://api.ebulksms.com',
    ).replace(/\/+$/, '');
    this.username = this.config.get<string>('EBULK_USERNAME', '');
    this.apikey = this.config.get<string>('EBULK_API_KEY', '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      // ebulksms REQUIRES an explicit `application/json` content type header.
      // Omit it and the API answers `UNKNOWN_CONTENTTYPE` / a bare 500.
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async buySms(order: VendorOrder): Promise<VendorResult> {
    const recipients = (order.recipients ?? [])
      .map((phone) => toInternationalFormat(phone))
      .filter((phone): phone is string => phone !== null);

    if (recipients.length === 0) {
      throw new BadRequestException(
        'No valid Nigerian recipient numbers — ebulksms requires numbers in international format (234…)',
      );
    }
    if (!order.senderName) {
      throw new BadRequestException('Sender name is required by ebulksms');
    }
    if (!order.message) {
      throw new BadRequestException('Message content is required by ebulksms');
    }

    // Per-recipient unique message id — deterministic from the order requestId
    // so delivery reports (getdlr.json) could be keyed by `requestId-N` later.
    const gsm = recipients.map((msidn, index) => ({
      msidn,
      msgid: `${order.requestId}-${index + 1}`,
    }));

    const payload = {
      SMS: {
        auth: { username: this.username, apikey: this.apikey },
        message: {
          sender: order.senderName,
          messagetext: order.message,
          flash: this.config.get<string>('EBULK_FLASH') === '1' ? '1' : '0',
        },
        recipients: { gsm },
        dndsender: this.config.get<string>('EBULK_DND') === '1' ? '1' : '0',
      },
    };

    const { data } = await this.client.post('/sendsms.json', payload);
    return this.mapSendResult(data, order);
  }

  private mapSendResult(data: any, order: VendorOrder): VendorResult {
    const root = data?.response ?? data ?? {};
    const status = String(root?.status ?? '').toUpperCase().trim();
    const totalsent = Number(root?.totalsent);
    const cost = Number(root?.cost);
    const recipientsCount = order.recipients?.length ?? 0;

    if (status === 'SUCCESS') {
      return {
        status: 'success',
        vendorReference: order.requestId,
        meta: {
          provider: 'ebulksms',
          totalsent: Number.isFinite(totalsent) ? totalsent : recipientsCount,
          cost: Number.isFinite(cost) ? cost : 0,
          recipients: recipientsCount,
          message: `Accepted by ebulksms — ${Number.isFinite(totalsent) ? totalsent : recipientsCount} recipient(s)`,
        },
      };
    }

    if (EbulksmsProvider.FAILURE_STATUSES.has(status)) {
      return { status: 'failed', message: this.describeStatus(status) };
    }

    // Any reply we did not map (unexpected status) is 'pending' — the message
    // may still have been accepted server-side, so Requery is the safe path
    // instead of an automatic (and possibly double-send) refund.
    this.logger.warn(`eBulkSMS returned an unexpected status: ${status || '(empty)'}`);
    return {
      status: 'pending',
      message: `eBulkSMS replied with an unrecognised status (${status || 'empty'}). Use Requery or contact support.`,
    };
  }

  private describeStatus(status: string): string {
    const messages: Record<string, string> = {
      INVALID_JSON: 'The JSON payload sent to eBulkSMS was invalid.',
      MISSING_USERNAME: 'eBulkSMS username is missing.',
      MISSING_APIKEY: 'eBulkSMS API key is missing.',
      AUTH_FAILURE: 'eBulkSMS authentication failed — check the account username and API key.',
      MISSING_SENDER: 'Sender name was not supplied.',
      MISSING_MESSAGE: 'Message content was empty.',
      MISSING_RECIPIENT: 'No recipient numbers were found.',
      INVALID_RECIPIENT: 'One or more recipient numbers are invalid.',
      INVALID_MESSAGE: 'Message is too long (max 612 chars) or contains characters eBulkSMS cannot send.',
      INVALID_SENDER: 'Sender name is invalid or missing.',
      INSUFFICIENT_CREDIT: 'The eBulkSMS account has insufficient credit for this campaign.',
      UNKNOWN_CONTENTTYPE: 'The request Content-Type was not application/json.',
      UNKNOWN_ERROR: 'eBulkSMS reported an unknown error.',
    };
    return messages[status] ?? `eBulkSMS rejected the request: ${status}`;
  }

  async getBalance(): Promise<{ balance: number; currency: string }> {
    try {
      const { data } = await this.client.get(
        `/balance/${encodeURIComponent(this.username)}/${encodeURIComponent(this.apikey)}`,
      );
      // Documented reply is plain-text unit count; guard against a JSON body too.
      const parsed =
        typeof data === 'string'
          ? Number(data.trim())
          : Number(data?.balance ?? data?.units ?? data?.cost ?? NaN);
      const balance = Number.isFinite(parsed) ? parsed : 0;
      return { balance, currency: 'NGN' };
    } catch {
      return { balance: 0, currency: 'NGN' };
    }
  }

  /**
   * ebulksms resolves each send synchronously: by the time `sendsms.json`
   * replies, the message was either accepted (`SUCCESS`) or rejected with one
   * of the documented statuses — both handled in `buySms`. There is no public
   * "find order by requestId" endpoint, so a still-pending SMS cannot be
   * confirmed via Requery. Keep it pending (no refund) so an SMS that was in
   * flight at send time is never silently refunded and double-sent.
   */
  async requery(_params: RequeryParams): Promise<VendorResult> {
    return {
      status: 'pending',
      message:
        'eBulkSMS has no order-status endpoint — this pending SMS cannot be confirmed via Requery. Contact support if it does not settle.',
    };
  }

  async verifyCustomer(_params: VerifyParams): Promise<CustomerVerification> {
    throw new BadRequestException(
      'Cable / electricity verification is not supported by the ebulksms provider',
    );
  }

  private unsupported(service: ServiceType): VendorResult {
    return {
      status: 'failed',
      message: `${service} purchases are not supported by the ebulksms provider — configure VENDOR_PROVIDER=vtpass for that service.`,
    };
  }

  async buyAirtime(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.AIRTIME);
  }

  async buyData(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.DATA);
  }

  async buyCable(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.CABLE);
  }

  async buyElectricity(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.ELECTRICITY);
  }

  async buyWaec(_order: VendorOrder): Promise<VendorResult> {
    return this.unsupported(ServiceType.WAEC);
  }
}