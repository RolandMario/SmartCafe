import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DedicatedAccount } from './schemas/dedicated-account.schema';
import { PaystackService } from '../payments/paystack.service';
import { User } from '../users/schemas/user.schema';
import { PaystackDedicatedAccountData } from '../payments/paystack.types';

/** Paystack errors returned when the customer already has a DVA. */
const DUPLICATE_DVA_RE =
  /already has a dedicated account|dedicated account already exists|existing dedicated account|dedicated account exist/i;

/** Public DVA shape exposed over the API (provider internals stripped). */
export interface DedicatedAccountView {
  _id: string;
  status: 'pending' | 'active' | 'failed';
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  customerCode: string;
  provider: string;
  createdAt?: Date;
}

/**
 * Per-user dedicated virtual accounts (bank-transfer wallet funding).
 *
 * Lifecycle:
 *  1. `getOrCreate()` resolves the user's Paystack customer (by email, creating
 *     it on 404), then creates the DVA. Banks that assign synchronously
 *     (test-bank, titan-paystack) return `assigned: true` with the number and
 *     the row is stored as `active` immediately. Wema/Providus assign
 *     asynchronously → the row is `pending` and finished by either the
 *     `dedicatedaccount.assign.success` webhook or a requery (`getByUser()`
 *     re-checks `pending` rows on read).
 *  2. A duplicate-customer rejection is treated as "already exists": we fall
 *     back to listing the customer's DVA and reuse it.
 *  3. Once `active`, the account never changes (one DVA per customer).
 */
@Injectable()
export class DedicatedAccountService {
  private readonly logger = new Logger(DedicatedAccountService.name);

  constructor(
    @InjectModel(DedicatedAccount.name)
    private model: Model<DedicatedAccount>,
    @InjectModel(User.name) private userModel: Model<User>,
    private paystack: PaystackService,
  ) {}

  static toView(doc: DedicatedAccount | null): DedicatedAccountView | null {
    if (!doc) return null;
    return {
      _id: doc._id.toString(),
      status: doc.status,
      accountNumber: doc.accountNumber,
      accountName: doc.accountName,
      bankName: doc.bankName,
      customerCode: doc.customerCode,
      provider: doc.provider,
      createdAt: doc.createdAt,
    };
  }

  /**
   * The user's DVA, or null when never created. A `pending` row is re-checked
   * against Paystack (requery) so reads converge to `active` even without a
   * webhook delivery.
   */
  async getByUser(userId: string): Promise<DedicatedAccount | null> {
    const doc = await this.model.findOne({
      user: new Types.ObjectId(userId),
    });
    if (doc && doc.status === 'pending' && !doc.accountNumber) {
      await this.tryFinalize(doc);
    }
    return doc;
  }

  /**
   * Idempotent get-or-create. Safe to call from two devices at once: the unique
   * user index resolves local races and the Paystack duplicate-customer guard
   * resolves provider races.
   */
  async getOrCreate(userId: string): Promise<DedicatedAccountView> {
    const existing = await this.getByUser(userId);
    if (existing) return DedicatedAccountService.toView(existing)!;

    if (!this.paystack.isConfigured()) {
      throw new BadGatewayException(
        'Paystack is not configured — bank-transfer accounts are unavailable.',
      );
    }

    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');

    // 1) Resolve or create the Paystack customer keyed by email.
    const { customerCode } = await this.paystack.getOrCreateCustomer({
      email: user.email,
      name: user.name ?? '',
      phone: user.phone,
    });

    try {
      const dva = await this.paystack.createDedicatedAccount({ customerCode });
      return DedicatedAccountService.toView(
        await this.persist(userId, customerCode, dva),
      )!;
    } catch (e) {
      // 2) Duplicate → reuse the customer's live DVA (see module docs).
      if (e instanceof BadGatewayException && DUPLICATE_DVA_RE.test(e.message)) {
        const list = await this.paystack.listCustomerDedicatedAccounts(
          customerCode,
        );
        const dva = list.find((d) => d.account_number) ?? list[0];
        if (!dva) {
          throw new BadGatewayException(
            'Your Paystack dedicated account could not be reused. Please retry.',
          );
        }
        this.logger.warn(
          `Reusing existing Paystack DVA for customer ${customerCode}`,
        );
        return DedicatedAccountService.toView(
          await this.persist(userId, customerCode, dva),
        )!;
      }
      throw e;
    }
  }

  /**
   * Handle a `dedicatedaccount.assign.success|failed` webhook. Paystack can
   * re-broadcast these for already-assigned accounts, so this only ever
   * upgrades a `pending` row (or refreshes an `active` one) — never creates.
   */
  async handleAssignmentWebhook(payload: Record<string, any>): Promise<void> {
    const event = String(payload?.event ?? '');
    const data = payload?.data ?? {};
    const customerCode = String(
      data.customer_code ?? data.customer?.customer_code ?? '',
    );
    if (!customerCode) {
      this.logger.warn(`${event} webhook missing customer_code`);
      return;
    }

    const doc = await this.model.findOne({ customerCode });
    if (!doc) return; // Not ours to handle (yet) — ignore.

    if (event.endsWith('.success')) {
      const accountNumber = String(
        data.account_number ??
          data.assignment?.account_number ??
          doc.accountNumber ??
          '',
      );
      if (accountNumber) {
        doc.status = 'active';
        doc.accountNumber = accountNumber;
        doc.accountName =
          String(data.account_name ?? doc.accountName ?? '').trim() ||
          doc.accountName;
        doc.bankName =
          String(data.bank?.name ?? doc.bankName ?? '').trim() ||
          doc.bankName;
        doc.providerMeta = {
          ...(doc.providerMeta ?? {}),
          assignmentWebhook: payload,
        };
        doc.processedAt = new Date();
        await doc.save();
        this.logger.log(
          `DVA ${accountNumber} finalized for customer ${customerCode}`,
        );
      }
    } else if (event.endsWith('.failed')) {
      doc.status = 'failed';
      doc.providerMeta = {
        ...(doc.providerMeta ?? {}),
        assignmentWebhook: payload,
      };
      doc.processedAt = new Date();
      await doc.save();
      this.logger.warn(`DVA assignment failed for customer ${customerCode}`);
    }
  }

  /**
   * Persist the DVA record, mapping the provider response to our status.
   * Handles a concurrent-create race (unique user index) by returning the
   * winner's row.
   */
  private async persist(
    userId: string,
    customerCode: string,
    dva: PaystackDedicatedAccountData,
  ): Promise<DedicatedAccount> {
    const provisioning = dva.assignment?.status === 'provisioning';
    const assigned =
      dva.assigned === true || (!!dva.assignment && !provisioning);
    const status: 'pending' | 'active' =
      assigned && !!dva.account_number ? 'active' : 'pending';

    try {
      return await this.model.create({
        user: new Types.ObjectId(userId),
        provider: 'paystack',
        customerCode,
        status,
        accountNumber: dva.account_number,
        accountName: dva.account_name,
        bankName: dva.bank?.name,
        providerAccountId: dva.id,
        providerMeta: { create: dva },
        ...(status === 'active' ? { processedAt: new Date() } : {}),
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        const existing = await this.model.findOne({
          user: new Types.ObjectId(userId),
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /** Requery an async assignment and persist the provisioned account. */
  private async tryFinalize(doc: DedicatedAccount): Promise<void> {
    try {
      const result = await this.paystack.requeryDedicatedAccount({
        customerCode: doc.customerCode,
      });
      if (result.assigned && result.account_number) {
        doc.status = 'active';
        doc.accountNumber = result.account_number;
        doc.accountName =
          String(result.account_name ?? doc.accountName ?? '').trim() ||
          doc.accountName;
        doc.bankName =
          String(result.bank?.name ?? doc.bankName ?? '').trim() ||
          doc.bankName;
        doc.providerMeta = {
          ...(doc.providerMeta ?? {}),
          requery: result,
        };
        doc.processedAt = new Date();
        await doc.save();
        this.logger.log(
          `Requery finalized DVA ${result.account_number} for ${doc.customerCode}`,
        );
      }
    } catch (e) {
      // Transient gateway error — keep the row pending and return it as-is.
      this.logger.warn(
        `DVA requery failed for ${doc.customerCode}: ${String(e)}`,
      );
    }
  }
}