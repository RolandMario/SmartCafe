import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Funding } from './schemas/funding.schema';
import { WalletService } from '../wallet/wallet.service';
import { FundingStatus } from '../common/enums';
import { generateReference } from '../common/utils/reference';
import { PaginationDto } from '../common/dto/pagination.dto';
import { QueryFundingDto } from './dto/funding.dto';
import {
  PaymentGateway,
  PaymentProvider,
  PaymentVerifyResult,
} from '../payments/payment-gateway.interface';
import { PaymentGatewayRegistry } from '../payments/payment-gateway.registry';
import { User } from '../users/schemas/user.schema';

@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    @InjectModel(Funding.name) private fundingModel: Model<Funding>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectConnection() private connection: Connection,
    private walletService: WalletService,
    private gateways: PaymentGatewayRegistry,
  ) {}

  /**
   * Create a wallet deposit request.
   *
   * When a payment gateway is configured (Monnify or Paystack) this
   * initialises a hosted checkout session and returns the `checkoutUrl` for
   * the client to open. `requestedProvider` lets the client pick a gateway;
   * it is honoured only when that gateway is configured. If nothing is
   * available it falls back to the legacy manual flow (admin reviews and
   * credits the wallet).
   */
  async createDeposit(
    userId: string,
    amount: number,
    requestBaseUrl?: string,
    requestedProvider?: PaymentProvider | string,
  ) {
    const user = await this.userModel.findById(userId);
    const reference = generateReference('FND');

    const funding = await this.fundingModel.create({
      user: new Types.ObjectId(userId),
      amount,
      reference,
      paymentReference: reference,
      status: FundingStatus.PENDING,
      provider: 'manual',
    });

    const gateway = this.gateways.resolve(requestedProvider);
    if (gateway) {
      let init: Awaited<ReturnType<PaymentGateway['initializeTransaction']>>;
      try {
        init = await gateway.initializeTransaction({
          amount,
          customerName: user?.name ?? 'Customer',
          customerEmail: user?.email ?? '',
          paymentReference: reference,
          paymentDescription: 'Wallet top-up',
          redirectUrl: gateway.buildRedirectUrl(requestBaseUrl),
        });
      } catch (e) {
        // Can't reach the gateway — leave the request pending for the manual
        // flow instead of failing the deposit entirely.
        this.logger.warn(
          `${gateway.name} checkout init failed, falling back to manual: ${String(e)}`,
        );
        return { funding, provider: 'manual' as const, checkoutUrl: null, paymentReference: reference };
      }

      funding.provider = gateway.name;
      funding.method = gateway.label;
      funding.checkoutUrl = init.checkoutUrl;
      funding.transactionReference = init.transactionReference;
      funding.providerMeta = {
        merchantName: init.merchantName,
        enabledPaymentMethod: init.enabledPaymentMethod,
      };
      await funding.save();

      return {
        funding,
        provider: gateway.name,
        checkoutUrl: init.checkoutUrl,
        paymentReference: init.paymentReference,
      };
    }

    return { funding, provider: 'manual' as const, checkoutUrl: null, paymentReference: reference };
  }

  async mine(userId: string, query: PaginationDto) {
    const [items, total] = await Promise.all([
      this.fundingModel
        .find({ user: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.fundingModel.countDocuments({ user: new Types.ObjectId(userId) }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async adminList(query: QueryFundingDto) {
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([
      this.fundingModel
        .find(filter)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.fundingModel.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  /**
   * Check a deposit's live status against the payment gateway and, when paid,
   * credit the wallet. Used by the mobile app after the customer closes the
   * hosted checkout. Webhook and this route both use an atomic status claim,
   * so only one of them ever credits a given request.
   */
  async verifyPayment(userId: string, paymentReference: string) {
    const funding = await this.fundingModel.findOne({ paymentReference });
    if (!funding || funding.user.toString() !== userId) {
      throw new NotFoundException('Funding request not found');
    }
    if (funding.status !== FundingStatus.PENDING) return funding;
    if (funding.provider === 'manual') return funding;

    const gateway = this.gateways.get(funding.provider);
    if (!gateway?.isConfigured()) return funding;

    const verification = await gateway.verifyPaymentByReference(paymentReference);
    if (verification.outcome === 'success') {
      await this.creditIfPaid(paymentReference, verification);
    } else if (verification.outcome === 'failed') {
      await this.markFailedIfPending(paymentReference, verification.paymentStatus);
    }
    return this.fundingModel.findOne({ paymentReference });
  }

  /**
   * Handle a payment-gateway webhook notification.
   * - The gateway's signature is validated when present (production).
   * - Sandbox notifications may carry no signature — allowed only when the
   *   gateway's `*_WEBHOOK_INSECURE` flag is set.
   * - Success events are always double-checked via the verify API before
   *   crediting, so a forged or noisy webhook can never credit a wallet.
   */
  async handleWebhook(
    provider: PaymentProvider,
    event: {
      /** The full gateway webhook payload (provider-specific shape). */
      payload: Record<string, any>;
      rawBody: Buffer;
      signature?: string;
      sourceIp?: string;
    },
  ) {
    const gateway = this.gateways.get(provider);
    if (!gateway) {
      throw new UnauthorizedException(`Unknown payment provider: ${provider}`);
    }

    const { payload, rawBody, signature, sourceIp } = event;

    // Optional IP allow-list (production webhooks originate from allowedIp()).
    const allowedIp = gateway.allowedIp();
    if (allowedIp && sourceIp && sourceIp !== allowedIp) {
      throw new UnauthorizedException('Webhook source IP not allowed');
    }

    const validSignature = signature ? gateway.verifyWebhookSignature(rawBody, signature) : false;
    if (signature && !validSignature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!signature && !gateway.allowInsecureWebhooks()) {
      this.logger.warn(
        `Rejected unsigned ${gateway.name} webhook (enable ${provider.toUpperCase()}_WEBHOOK_INSECURE in sandbox)`,
      );
      throw new UnauthorizedException('Missing webhook signature');
    }

    const { eventClass, providerEventType } = gateway.classifyWebhookEvent(payload);
    const paymentReference = gateway.extractPaymentReference(payload);
    if (!paymentReference) {
      this.logger.warn(`${gateway.label} webhook "${providerEventType}" missing paymentReference`);
      return { received: true, ignored: true };
    }

    const funding = await this.fundingModel.findOne({ paymentReference });
    if (!funding) {
      this.logger.warn(
        `${gateway.label} webhook "${providerEventType}" for unknown paymentReference ${paymentReference}`,
      );
      return { received: true, ignored: true };
    }
    if (funding.status !== FundingStatus.PENDING) {
      return { received: true, ignored: true };
    }

    if (eventClass === 'success') {
      // Authoritative check before crediting.
      const verification = await gateway.verifyPaymentByReference(paymentReference);
      if (verification.outcome === 'success') {
        await this.creditIfPaid(paymentReference, verification);
      } else if (verification.outcome === 'failed') {
        await this.markFailedIfPending(paymentReference, verification.paymentStatus);
      }
    } else if (eventClass === 'failed') {
      await this.markFailedIfPending(paymentReference, providerEventType);
    }

    return { received: true };
  }

  /**
   * Atomically mark a PENDING funding request as credited and credit the
   * wallet — both inside one MongoDB transaction so the webhook and the
   * mobile polling route can race without double-crediting.
   */
  private async creditIfPaid(paymentReference: string, verification: PaymentVerifyResult) {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const funding = await this.fundingModel.findOne({ paymentReference }).session(session);
        if (!funding || funding.status !== FundingStatus.PENDING) return;

        if (verification.amountPaid < funding.amount) {
          this.logger.warn(
            `Amount mismatch for ${paymentReference}: expected ${funding.amount}, paid ${verification.amountPaid}`,
          );
          funding.status = FundingStatus.FAILED;
          funding.adminNote = `Payment below expected amount (${verification.paymentStatus})`;
          funding.providerMeta = {
            ...(funding.providerMeta ?? {}),
            verification: verification.raw,
          };
          await funding.save({ session });
          return;
        }

        funding.status = FundingStatus.CREDITED;
        funding.processedAt = new Date();
        funding.adminNote = `Paid via ${funding.method} (${verification.paymentStatus})`;
        funding.transactionReference = verification.transactionReference ?? funding.transactionReference;
        funding.providerMeta = {
          ...(funding.providerMeta ?? {}),
          paidOn: verification.paidOn,
          paymentMethod: verification.paymentMethod,
          verification: verification.raw,
        };
        await funding.save({ session });

        await this.walletService.credit(
          funding.user.toString(),
          funding.amount,
          `Wallet funding (${funding.reference})`,
          undefined,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    this.logger.log(`Credited wallet for funding ${paymentReference}`);
  }

  private async markFailedIfPending(paymentReference: string, reason: string) {
    const funding = await this.fundingModel.findOneAndUpdate(
      { paymentReference, status: FundingStatus.PENDING },
      {
        $set: {
          status: FundingStatus.FAILED,
          processedAt: new Date(),
          adminNote: `Payment failed (${reason})`,
        },
      },
      { new: true },
    );
    if (funding) this.logger.log(`Marked funding ${paymentReference} as failed (${reason})`);
  }

  async approve(id: string, adminId: string, note?: string) {
    const funding = await this.fundingModel.findById(id);
    if (!funding) throw new NotFoundException('Funding request not found');
    if (funding.status !== FundingStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }
    funding.status = FundingStatus.CREDITED;
    funding.processedBy = new Types.ObjectId(adminId);
    funding.processedAt = new Date();
    funding.adminNote = note;
    await funding.save();
    await this.walletService.credit(
      funding.user.toString(),
      funding.amount,
      `Wallet funding (${funding.reference})`,
    );
    return funding;
  }

  async reject(id: string, adminId: string, note?: string) {
    const funding = await this.fundingModel.findById(id);
    if (!funding) throw new NotFoundException('Funding request not found');
    if (funding.status !== FundingStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }
    funding.status = FundingStatus.FAILED;
    funding.processedBy = new Types.ObjectId(adminId);
    funding.processedAt = new Date();
    funding.adminNote = note;
    await funding.save();
    return funding;
  }
}