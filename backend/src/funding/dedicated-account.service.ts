import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { DedicatedAccount } from './schemas/dedicated-account.schema';
import { PaystackService } from '../payments/paystack.service';
import { User } from '../users/schemas/user.schema';
import { PaystackDedicatedAccountData } from '../payments/paystack.types';
import { Funding } from './schemas/funding.schema';
import { FundingStatus } from '../common/enums';
import { WalletService } from '../wallet/wallet.service';

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
    @InjectModel(Funding.name) private fundingModel: Model<Funding>,
    @InjectConnection() private connection: Connection,
    private paystack: PaystackService,
    private walletService: WalletService,
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

  /**
   * True when a Paystack webhook is a bank transfer deposited into a dedicated
   * virtual account. Paystack sends DVA receipts as plain `charge.success`
   * events — there is no separate `dedicatedaccount.credit` event — and the
   * channel (`data.channel` and/or `data.authorization.channel`) is what tells
   * the transfer landed on the virtual account number. Checkout payments via
   * card/bank-transfer use other channels and are never matched here.
   */
  static isDvaCreditEvent(payload: Record<string, any>): boolean {
    if (String(payload?.event ?? '') !== 'charge.success') return false;
    const data = payload?.data ?? {};
    const channel = String(data.channel ?? data.authorization?.channel ?? '');
    return channel === 'dedicated_nuban';
  }

  /**
   * Credit a user's wallet for money transferred into their dedicated virtual
   * account (`charge.success` with channel `dedicated_nuban`), completing the
   * funding flow end-to-end.
   *
   *  1. Match the DVA row by Paystack customer code (fallback: the receiving
   *     account number) so the deposit reaches the right app user.
   *  2. Create a `credited` funding record keyed on the deposit's own Paystack
   *     reference — never a user-generated `FND...` reference, so it cannot
   *     collide with checkout/manual funding.
   *  3. Credit the wallet inside the same MongoDB transaction, so a crash
   *     between the two can never record money without crediting (or credit
   *     without a record).
   *
   * Idempotency: Paystack retries webhooks until acknowledged, so the first
   * delivery to win writes the record + credits the wallet; every later
   * delivery finds the existing record and no-ops. A concurrent duplicate that
   * loses the unique-`reference` race surfaces as duplicate-key (11000) and is
   * treated as already processed.
   */
  async handleCreditWebhook(payload: Record<string, any>): Promise<void> {
    if (!DedicatedAccountService.isDvaCreditEvent(payload)) return;

    const data = payload?.data ?? {};
    const providerReference = String(data.reference ?? '');
    if (!providerReference) {
      this.logger.warn('DVA charge.success webhook missing data.reference');
      return;
    }
    const currency = String(data.currency ?? 'NGN').toUpperCase();
    if (currency !== 'NGN') {
      this.logger.warn(
        `Ignoring DVA deposit ${providerReference} in ${currency} (only NGN supported)`,
      );
      return;
    }
    const amountKobo = Number(data.amount);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      this.logger.warn(
        `Ignoring DVA deposit ${providerReference} with invalid amount ${data.amount}`,
      );
      return;
    }

    // Match to our user — DVA rows are keyed by Paystack customer code, and
    // the receiving account number is a safe fallback some payloads carry.
    const customerCode = String(
      data.customer?.customer_code ?? data.customer_code ?? '',
    );
    const accountNumber = String(
      data.authorization?.receiver_bank_account_number ?? '',
    );
    const dva = await this.model.findOne(
      customerCode && accountNumber
        ? { $or: [{ customerCode }, { accountNumber }] }
        : customerCode
          ? { customerCode }
          : accountNumber
            ? { accountNumber }
            : { _id: null },
    );
    if (!dva) {
      this.logger.warn(
        `Ignoring DVA deposit ${providerReference} for unknown customer ${
          customerCode || accountNumber || '(no identifier)'
        }`,
      );
      return;
    }

    const amount = amountKobo / 100; // wire amounts are in kobo
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const existing = await this.fundingModel
          .findOne({ paymentReference: providerReference })
          .session(session);
        if (existing) return; // already processed by an earlier delivery

        await this.fundingModel.create(
          [
            {
              user: dva.user,
              amount,
              reference: `DVA-${providerReference}`,
              paymentReference: providerReference,
              status: FundingStatus.CREDITED,
              provider: 'paystack',
              method: 'Bank transfer (DVA)',
              adminNote: `Received${dva.accountNumber ? ` into ${dva.accountNumber}` : ''} (${dva.bankName ?? 'dedicated account'})`,
              processedAt: new Date(),
            },
          ],
          { session },
        );
        await this.walletService.credit(
          dva.user.toString(),
          amount,
          `Wallet funding (${providerReference})`,
          undefined,
          session,
        );
      });
    } catch (e: any) {
      // A concurrent delivery already claimed this deposit — safe to no-op.
      if (e?.code === 11000) {
        this.logger.log(
          `DVA deposit ${providerReference} already processed by a concurrent delivery`,
        );
      } else {
        throw e;
      }
    } finally {
      await session.endSession();
    }

    // Audit trail on the DVA row (outside the transaction — informational).
    dva.providerMeta = {
      ...(dva.providerMeta ?? {}),
      latestDeposit: { reference: providerReference, amount, paidAt: new Date() },
    };
    await dva.save().catch((e) =>
      this.logger.warn(
        `DVA audit update failed (${providerReference}): ${String(e)}`,
      ),
    );

    this.logger.log(
      `Credited wallet ₦${amount} for DVA deposit ${providerReference}`,
    );
  }
}