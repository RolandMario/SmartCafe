import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types, ClientSession } from 'mongoose';
import { Transaction } from './schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';
import { VendorOrder, VendorResult } from '../vendors/vendor-provider.interface';
import { ServiceType, TransactionStatus, PaymentWallet } from '../common/enums';
import { generateReference, generateRequestId } from '../common/utils/reference';
import { QueryTransactionsDto } from './dto/transactions.dto';

export interface BeginPurchaseInput {
  userId: string;
  service: ServiceType;
  amount: number;
  description: string;
  meta: Record<string, any>;
  /** Vendor-specific order fields (productCode, phone, card no, ...) */
  order: Omit<VendorOrder, 'requestId' | 'amount' | 'serviceType'>;
  /** 4-digit transaction PIN authorising this purchase */
  pin?: string;
  /**
   * The amount the vendor provider will charge for this order (used for profit
   * reports). Captured from the vendor's own response when available; services
   * whose APIs expose no charge (SMS) pass the admin-configured rate here.
   */
  providerCost?: number;
  /** Which wallet funds this purchase ('main' | 'cashback'). Defaults to 'main'. */
  paymentWallet?: PaymentWallet;
  /**
   * Cashback credited to the user's cashback wallet when this purchase settles
   * as successful — captured from the catalog item's admin-set commission.
   * Always >= 0; 0 means the product earns no cashback.
   */
  cashback?: number;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction>,
    private walletService: WalletService,
    private vendorService: VendorService,
    private usersService: UsersService,
    @InjectConnection() private connection: Connection,
  ) {}

  async myTransactions(userId: string, query: QueryTransactionsDto) {
    const filter: Record<string, any> = { user: new Types.ObjectId(userId) };
    if (query.service) filter.service = query.service;
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.transactionModel.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Purchase analytics for the current user: how many successful purchases
   * (and how much was spent) per service.
   *
   * Pass `month` as `YYYY-MM` to scope the aggregation to that calendar month
   * (UTC); omit it for all-time totals. Every known service is returned
   * (zero-filled) so the client can always draw the full chart.
   */
  async stats(userId: string, month?: string) {
    const match: Record<string, any> = {
      user: new Types.ObjectId(userId),
      status: TransactionStatus.SUCCESS,
    };
    if (month) {
      const [year, mon] = month.split('-').map(Number);
      match.createdAt = {
        $gte: new Date(Date.UTC(year, mon - 1, 1)),
        $lt: new Date(Date.UTC(year, mon, 1)),
      };
    }

    const rows = await this.transactionModel.aggregate<{
      _id: ServiceType;
      count: number;
      volume: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: '$service',
          count: { $sum: 1 },
          volume: { $sum: '$amount' },
        },
      },
    ]);

    const byService = new Map(rows.map((r) => [r._id, r]));
    const items = Object.values(ServiceType).map((service) => {
      const row = byService.get(service);
      return { service, count: row?.count ?? 0, volume: row?.volume ?? 0 };
    });
    const total = items.reduce((sum, i) => sum + i.count, 0);

    return { month: month ?? 'all', total, items };
  }

  async findForUser(userId: string, id: string) {
    let txn: Transaction | null = null;
    if (Types.ObjectId.isValid(id)) {
      txn = await this.transactionModel.findOne({
        _id: id,
        user: new Types.ObjectId(userId),
      });
    }
    if (!txn) {
      txn = await this.transactionModel.findOne({
        reference: id,
        user: new Types.ObjectId(userId),
      });
    }
    if (!txn) throw new NotFoundException('Transaction not found');
    return txn;
  }

  async findById(id: string) {
    const txn = await this.transactionModel.findById(id).populate('user', 'name email phone');
    if (!txn) throw new NotFoundException('Transaction not found');
    return txn;
  }

  /**
   * Orchestrates a purchase: validates the 4-digit transaction PIN,
   * atomic wallet debit + pending transaction, vendor call, then settlement
   * (success / refund-on-failure / pending).
   */
  async beginPurchase(input: BeginPurchaseInput) {
    if (!input.pin) {
      throw new BadRequestException(
        'A 4-digit transaction PIN is required to complete this purchase',
      );
    }
    this.logger.log(
      `[purchase] begin user=${input.userId} service=${input.service} amount=${input.amount} wallet=${input.paymentWallet ?? 'main'} meta=${JSON.stringify(input.meta)}`,
    );
    const pinOk = await this.usersService.verifyPin(input.userId, input.pin);
    if (!pinOk) {
      // 403 (not 401): the user IS authenticated — the transaction PIN is
      // simply wrong. 401 is reserved for session/access-token failures so
      // clients only auto-refresh their token when the session really expired.
      this.logger.warn(`[purchase] PIN rejected for user=${input.userId}`);
      throw new ForbiddenException('Incorrect transaction PIN');
    }

    const reference = generateReference('VTU');
    const requestId = generateRequestId();
    const session = await this.connection.startSession();
    let transaction: Transaction | null = null;
    const paymentWallet = input.paymentWallet ?? PaymentWallet.MAIN;

    await session.withTransaction(async () => {
      if (paymentWallet === PaymentWallet.CASHBACK) {
        // Cashback-funded purchase. Atomic, never overdraws (no-negative balance).
        await this.walletService.debitCashback(
          input.userId,
          input.amount,
          input.description,
          undefined,
          session,
        );
      } else {
        await this.walletService.debit(
          input.userId,
          input.amount,
          input.description,
          undefined,
          session,
        );
      }
      [transaction] = await this.transactionModel.create(
        [
          {
            user: new Types.ObjectId(input.userId),
            service: input.service,
            reference,
            requestId,
            amount: input.amount,
            ...(input.providerCost != null ? { providerCost: input.providerCost } : {}),
            paymentWallet,
            cashback: input.cashback ?? 0,
            meta: input.meta,
            status: TransactionStatus.PENDING,
          },
        ],
        { session },
      );
    });
    await session.endSession();

    if (!transaction) {
      throw new BadRequestException('Could not initialise purchase');
    }
    // TS can't see the assignment inside withTransaction's callback, so capture
    // a concrete Transaction reference for the rest of the flow.
    const createdTransaction = transaction as Transaction;
    this.logger.log(
      `[purchase] transaction ${createdTransaction.reference} created (${createdTransaction._id}) — wallet debited, calling vendor`,
    );

    let result: VendorResult;
    try {
      result = await this.vendorService.buy({
        serviceType: input.service,
        requestId,
        amount: input.amount,
        ...input.order,
      });
      this.logger.log(
        `[purchase] vendor reply for ${createdTransaction.reference}: status=${result.status}${result.message ? ` message="${result.message}"` : ''}`,
      );
    } catch (err: any) {
      if (this.isAmbiguousVendorError(err)) {
        // The vendor may still have processed the request server-side (e.g. a
        // timeout while VTPass completes the purchase). Never refund on an
        // ambiguous error: keep the transaction 'pending' so requery(requestId)
        // can settle it to its true status.
        this.logger.warn(
          `Vendor call for ${input.service} (${reference}) received no reply — keeping pending for requery: ${String(err?.message ?? err)}`,
        );
        result = {
          status: 'pending',
          message:
            'We did not receive a reply from the vendor in time. The order may still be processing — use Requery in Transaction history to confirm its status.',
        };
      } else {
        this.logger.warn(
          `Vendor call for ${input.service} (${reference}) failed: ${String(err?.message ?? err)}`,
        );
        result = {
          status: 'failed',
          message: err?.message ?? 'Vendor request failed',
        };
      }
    }

    const settled = await this.settle(createdTransaction, result);
    this.logger.log(
      `[purchase] ${createdTransaction.reference} settled as ${settled.status}`,
    );
    return settled;
  }

  /**
   * A transport-level error (timeout, dropped connection, DNS failure) means we
   * never heard back from the vendor, so its outcome is UNKNOWN — it may have
   * completed the purchase. Errors that include a server response are definite.
   */
  private isAmbiguousVendorError(err: any): boolean {
    if (err?.response) return false; // got a reply -> definite outcome
    const code = String(err?.code ?? '');
    return [
      'ECONNABORTED', // axios request timeout
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EPIPE',
      'ECANCELED',
    ].includes(code);
  }

  async settle(transaction: Transaction, result: VendorResult) {
    this.logger.log(
      `[settle] ${transaction.reference}: vendorStatus=${result.status}${result.message ? ` message="${result.message}"` : ''}`,
    );
    if (result.status === 'success') {
      return this.settleSuccess(transaction, result);
    }

    if (result.status === 'failed') {
      // Refund to whichever wallet funded the purchase so both balances stay exact.
      const refundDescription = `Refund for failed ${transaction.service} (${transaction.reference})`;
      if (transaction.paymentWallet === PaymentWallet.CASHBACK) {
        await this.walletService.creditCashback(
          transaction.user.toString(),
          transaction.amount,
          refundDescription,
          transaction._id.toString(),
        );
      } else {
        await this.walletService.credit(
          transaction.user.toString(),
          transaction.amount,
          refundDescription,
          transaction._id.toString(),
        );
      }
      transaction.status = TransactionStatus.FAILED;
      transaction.failureReason = result.message ?? 'Vendor reported a failure';
      transaction.settledAt = new Date();
      await transaction.save();
      return { status: TransactionStatus.FAILED, transaction };
    }

    // pending: funds stay debited and can be settled via requery
    return { status: TransactionStatus.PENDING, transaction };
  }

  /**
   * Marks a purchase successful and credits the user's cashback wallet in one
   * atomic operation. The conditional update (cashbackCredited !== true)
   * guarantees cashback is granted exactly once, even if a concurrent requery
   * races settlement. On standalone (non-replica-set) dev databases, which
   * cannot run multi-document transactions, it falls back to a best-effort
   * sequential settle.
   */
  private async settleSuccess(transaction: Transaction, result: VendorResult) {
    const patch = {
      status: TransactionStatus.SUCCESS,
      vendorReference: result.vendorReference,
      providerMeta: { ...(result.meta ?? {}) },
      // The vendor's own reported charge is authoritative; fall back to the
      // amount passed along at purchase time (covers APIs with no price reply).
      ...(result.providerCost != null ? { providerCost: result.providerCost } : {}),
      commission: result.commission ?? 0,
      settledAt: new Date(),
      cashbackCredited: (transaction.cashback ?? 0) > 0,
    };

    // Keep the live document object in sync so callers/requery see the settled state.
    Object.assign(transaction, patch);

    const creditCashback = async (session?: ClientSession) => {
      const cashback = transaction.cashback ?? 0;
      if (cashback <= 0) return;
      await this.walletService.creditCashback(
        transaction.user.toString(),
        cashback,
        `Cashback earned - ${transaction.service} (${transaction.reference})`,
        transaction._id.toString(),
        session,
      );
    };

    const session = await this.connection.startSession();
    let claimed = false;
    try {
      await session.withTransaction(async () => {
        const updated = await this.transactionModel.findOneAndUpdate(
          { _id: transaction._id, cashbackCredited: { $ne: true } },
          { $set: patch },
          { session },
        );
        claimed = Boolean(updated);
        if (claimed) await creditCashback(session);
      });
    } catch (err) {
      if (!isTransactionUnsupportedError(err)) throw err;
      // Standalone MongoDB servers can't run multi-document transactions —
      // settle sequentially instead (idempotency still holds via the query guard).
      const updated = await this.transactionModel.findOneAndUpdate(
        { _id: transaction._id, cashbackCredited: { $ne: true } },
        { $set: patch },
      );
      claimed = Boolean(updated);
      if (claimed) await creditCashback();
    } finally {
      await session.endSession();
    }

    return { status: TransactionStatus.SUCCESS, transaction };
  }

  async requery(referenceOrId: string, userId?: string) {
    let transaction: Transaction | null = null;
    if (Types.ObjectId.isValid(referenceOrId)) {
      const query: Record<string, any> = { _id: referenceOrId };
      if (userId) query.user = new Types.ObjectId(userId);
      transaction = await this.transactionModel.findOne(query);
    }
    if (!transaction) {
      const query: Record<string, any> = { reference: referenceOrId };
      if (userId) query.user = new Types.ObjectId(userId);
      transaction = await this.transactionModel.findOne(query);
    }
    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.status === TransactionStatus.SUCCESS) {
      return { status: TransactionStatus.SUCCESS, transaction };
    }
    const result = await this.vendorService.requery({
      serviceType: transaction.service,
      requestId: transaction.requestId,
    });
    return this.settle(transaction, result);
  }
}

/**
 * True when the MongoDB driver reports that this server cannot run
 * multi-document transactions (a standalone mongod rather than a replica set /
 * Atlas). Settlement then falls back to a sequential, non-transacted settle.
 */
function isTransactionUnsupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /transaction numbers are only allowed|transactions are not supported/i.test(
    err.message,
  );
}