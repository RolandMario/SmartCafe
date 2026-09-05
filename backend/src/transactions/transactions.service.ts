import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Transaction } from './schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';
import { VendorOrder, VendorResult } from '../vendors/vendor-provider.interface';
import { ServiceType, TransactionStatus } from '../common/enums';
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
    const pinOk = await this.usersService.verifyPin(input.userId, input.pin);
    if (!pinOk) {
      throw new UnauthorizedException('Incorrect transaction PIN');
    }

    const reference = generateReference('VTU');
    const requestId = generateRequestId();
    const session = await this.connection.startSession();
    let transaction: Transaction | null = null;

    await session.withTransaction(async () => {
      await this.walletService.debit(
        input.userId,
        input.amount,
        input.description,
        undefined,
        session,
      );
      [transaction] = await this.transactionModel.create(
        [
          {
            user: new Types.ObjectId(input.userId),
            service: input.service,
            reference,
            requestId,
            amount: input.amount,
            ...(input.providerCost != null ? { providerCost: input.providerCost } : {}),
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

    let result: VendorResult;
    try {
      result = await this.vendorService.buy({
        serviceType: input.service,
        requestId,
        amount: input.amount,
        ...input.order,
      });
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
        result = {
          status: 'failed',
          message: err?.message ?? 'Vendor request failed',
        };
      }
    }

    return this.settle(transaction, result);
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
    if (result.status === 'success') {
      transaction.status = TransactionStatus.SUCCESS;
      transaction.vendorReference = result.vendorReference;
      transaction.providerMeta = { ...(result.meta ?? {}) };
      // The vendor's own reported charge is authoritative; fall back to the
      // amount passed along at purchase time (covers APIs with no price reply).
      if (result.providerCost != null) transaction.providerCost = result.providerCost;
      transaction.commission = result.commission ?? 0;
      transaction.settledAt = new Date();
      await transaction.save();
      return { status: TransactionStatus.SUCCESS, transaction };
    }

    if (result.status === 'failed') {
      await this.walletService.credit(
        transaction.user.toString(),
        transaction.amount,
        `Refund for failed ${transaction.service} (${transaction.reference})`,
        transaction._id.toString(),
      );
      transaction.status = TransactionStatus.FAILED;
      transaction.failureReason = result.message ?? 'Vendor reported a failure';
      transaction.settledAt = new Date();
      await transaction.save();
      return { status: TransactionStatus.FAILED, transaction };
    }

    // pending: funds stay debited and can be settled via requery
    return { status: TransactionStatus.PENDING, transaction };
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